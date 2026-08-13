import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from "@nestjs/common";
import type {
  WorkOrder,
  WorkOrderRunEvent,
} from "@agent-studio/agent-schema";
import type {
  OrchestratorOutcome,
  OrchestratorProgress,
} from "@agent-studio/orchestrator";
import { DigitalHumansService } from "../digital-humans/digital-humans.service";
import {
  runStudioDecision,
  runStudioResume,
  runStudioStart,
  studioStateFromOutcome,
} from "./studio-orchestrator.adapter";
import { WorkOrdersService } from "./work-orders.service";

type AppendEventPartial = {
  type: WorkOrderRunEvent["type"];
  message: string;
  level?: WorkOrderRunEvent["level"];
  step_id?: string;
  agent?: string;
  bridge_stage?: string;
  bridge_run_id?: string;
  dry_run?: boolean;
  dify_status?: string;
  action?: string;
  detail?: Record<string, unknown>;
  id?: string;
  at?: string;
};

/**
 * Studio orchestrator jobs (start / decide / resume) — keeps HTTP handlers thin.
 * Bound to WorkOrdersService for persistence + multi-repo continue.
 */
@Injectable()
export class WorkOrderStudioRunner {
  private readonly logger = new Logger(WorkOrderStudioRunner.name);
  private readonly studioInFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly humans: DigitalHumansService,
    @Inject(forwardRef(() => WorkOrdersService))
    private readonly orders: WorkOrdersService,
  ) {}

  /** True while a background start/decide/resume job is in flight for this work order. */
  isBusy(workOrderId: string): boolean {
    return this.studioInFlight.has(workOrderId);
  }

  private nowIso() {
    return this.orders.nowIso();
  }

  private appendRunEvent(order: WorkOrder, partial: AppendEventPartial) {
    this.orders.appendRunEvent(order, partial);
  }

  private write(order: WorkOrder) {
    return this.orders.write(order);
  }

  private get(id: string) {
    return this.orders.get(id);
  }

  /** Drive Bridge stages via `@agent-studio/orchestrator` (no Dify). */
  async startFromDraft(
    previous: WorkOrder,
    draft: WorkOrder,
    opts: {
      agents_md_path?: string;
      routing_mode?: "auto" | "explicit";
      bridge_base_url?: string;
    },
  ): Promise<WorkOrder> {
    void previous;
    if (!draft.run) throw new BadRequestException("run missing");
    const bridgeBase =
      (opts.bridge_base_url || "").trim() || "http://127.0.0.1:8787";
    const stamp = this.nowIso();
    const agentsMdPath =
      opts.agents_md_path || draft.run.selected_agents_md_path || "auto";
    const routingMode = opts.routing_mode || "explicit";
    const autoApprove = Boolean(draft.run.auto_approve);

    draft.run.studio = {
      bridge_run_id: draft.run.studio?.bridge_run_id || "",
      bridge_base_url: bridgeBase,
      current_stage: draft.run.studio?.current_stage || "",
      last_summary: "Studio 编排启动中…",
      pending_human: false,
      dry_run: Boolean(draft.run.studio?.dry_run),
      status: "starting",
      error: null,
      last_synced_at: stamp,
    };
    const first = draft.run.steps[0];
    if (first && first.status === "pending") {
      first.status = "running";
      first.started_at = stamp;
    }
    this.appendRunEvent(draft, {
      type: "info",
      message: "Studio 编排已提交（后台执行 Bridge 阶段，页面可刷新查看进度）",
    });
    const saved = await this.write(draft);
    this.enqueueJob(saved.id, saved.run!.run_id, async (order) => {
      const humans = await this.humans.list({ enabled: "all" });
      const outcome = await runStudioStart({
        order,
        bridgeBaseUrl: bridgeBase,
        agentsMdPath,
        routingMode,
        humans,
        autoApprove,
        onProgress: async (progress) => {
          await this.persistProgress(
            order.id,
            order.run!.run_id,
            progress,
            bridgeBase,
          );
        },
      });
      const latest = await this.get(order.id);
      if (latest.run?.run_id !== order.run?.run_id) return;
      await this.applyOutcome(latest, outcome, bridgeBase);
    });
    return saved;
  }

  async decide(
    id: string,
    body: {
      decision?: "approve" | "reject";
      action?: string;
      feedback?: string;
    },
  ): Promise<WorkOrder> {
    let order = await this.get(id);
    if (
      order.status !== "pending_approval" &&
      !order.run?.studio?.pending_human
    ) {
      throw new BadRequestException("当前没有待确认的人工闸门");
    }
    const decision =
      body.decision ||
      (body.action && /reject|驳回|拒绝/i.test(body.action)
        ? "reject"
        : "approve");
    this.appendRunEvent(order, {
      type: "human_decision",
      message: `提交确认：${decision}${body.feedback ? ` · 反馈=${body.feedback}` : ""}`,
      action: decision,
      step_id: order.run?.steps[order.run.current_step_index]?.step_id,
      agent: order.run?.steps[order.run.current_step_index]?.agent,
    });
    if (order.run?.studio) {
      order.run.studio.status = "running";
      order.run.studio.pending_human = false;
      order.run.studio.last_summary = `已提交 ${decision}，继续编排中…`;
      order.run.studio.last_synced_at = this.nowIso();
    }
    order.status = "running";
    const step = order.run?.steps[order.run.current_step_index];
    if (step) step.status = "running";
    const saved = await this.write(order);
    const bridgeBase =
      saved.run?.studio?.bridge_base_url || "http://127.0.0.1:8787";
    const feedback = body.feedback || "";
    this.enqueueJob(saved.id, saved.run!.run_id, async (current) => {
      const humans = await this.humans.list({ enabled: "all" });
      const outcome = await runStudioDecision({
        order: current,
        decision,
        feedback,
        humans,
        onProgress: async (progress) => {
          await this.persistProgress(
            current.id,
            current.run!.run_id,
            progress,
            bridgeBase,
          );
        },
      });
      const latest = await this.get(current.id);
      if (latest.run?.run_id !== current.run?.run_id) return;
      await this.applyOutcome(latest, outcome, bridgeBase);
    });
    return saved;
  }

  /** Background resume after WorkOrdersService prepared failed → running state. */
  enqueueResume(
    order: WorkOrder,
    opts: { feedback: string; bridgeBase: string },
  ): void {
    const runId = order.run?.run_id;
    if (!runId) return;
    const { feedback, bridgeBase } = opts;
    this.enqueueJob(order.id, runId, async (current) => {
      const humans = await this.humans.list({ enabled: "all" });
      const outcome = await runStudioResume({
        order: current,
        feedback,
        humans,
        onProgress: async (progress) => {
          await this.persistProgress(
            current.id,
            current.run!.run_id,
            progress,
            bridgeBase,
          );
        },
      });
      const latest = await this.get(current.id);
      if (latest.run?.run_id !== current.run?.run_id) return;
      await this.applyOutcome(latest, outcome, bridgeBase);
    });
  }

  /** Mid-run progress for live UI (does not flip terminal statuses). */
  async persistProgress(
    workOrderId: string,
    runId: string,
    progress: OrchestratorProgress,
    bridgeBaseUrl: string,
  ): Promise<void> {
    const order = await this.get(workOrderId);
    if (!order.run || order.run.run_id !== runId) return;
    if (
      order.status === "completed" ||
      order.status === "failed" ||
      order.status === "rejected"
    ) {
      return;
    }
    const stamp = this.nowIso();
    const state = studioStateFromOutcome(
      {
        kind: "running",
        state: progress.state,
        step_index: progress.step_index,
        stage: progress.stage,
        summary: progress.summary,
        stage_result: progress.stage_result || {
          runId: progress.state.bridge_run_id,
          stage: progress.stage,
          status: "ok",
          summary: progress.summary,
          artifacts: [],
          pendingHumanApproval: false,
        },
      },
      bridgeBaseUrl,
    );
    order.status = "running";
    order.run.studio = {
      bridge_run_id: state.bridge_run_id || "",
      bridge_base_url: state.bridge_base_url || bridgeBaseUrl,
      current_stage: progress.stage || state.current_stage || "",
      last_summary: progress.summary || state.last_summary || "",
      pending_human: false,
      dry_run: Boolean(state.dry_run),
      status: "running",
      error: null,
      last_synced_at: stamp,
    };
    order.run.current_step_index = progress.step_index;
    for (let i = 0; i < order.run.steps.length; i++) {
      const s = order.run.steps[i]!;
      if (i < progress.step_index) {
        if (s.status === "pending" || s.status === "running") {
          s.status = "approved";
          s.finished_at = s.finished_at || stamp;
        }
      } else if (i === progress.step_index) {
        s.status = "running";
        s.started_at = s.started_at || stamp;
        s.summary = progress.summary || s.summary;
        if (progress.stage_result?.summary) {
          s.output = progress.stage_result.summary;
          s.output_title = s.output_title || s.label || progress.stage;
        }
        const arts = progress.stage_result?.artifacts || [];
        if (arts.length) {
          const merged = new Set([...(s.artifact_paths || []), ...arts]);
          s.artifact_paths = [...merged];
        }
      }
    }
    this.appendRunEvent(order, {
      type: "bridge_stage",
      message: progress.summary || `stage ${progress.stage}`,
      step_id: order.run.steps[progress.step_index]?.step_id,
      agent: order.run.steps[progress.step_index]?.agent,
      bridge_stage: progress.stage,
      detail: { stage: progress.stage, step_index: progress.step_index },
    });
    await this.write(order);
  }

  /** Run Studio orchestrator off the request path; ignore if a newer run replaced it. */
  enqueueJob(
    workOrderId: string,
    runId: string,
    job: (order: WorkOrder) => Promise<void>,
  ): void {
    const prev = this.studioInFlight.get(workOrderId);
    const run = (async () => {
      if (prev) {
        try {
          await prev;
        } catch {
          /* previous job failure already persisted */
        }
      }
      try {
        const order = await this.get(workOrderId);
        if (order.run?.run_id !== runId) return;
        await job(order);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `studio orchestrator failed for ${workOrderId}/${runId}: ${msg}`,
        );
        try {
          const latest = await this.get(workOrderId);
          if (latest.run?.run_id !== runId || !latest.run) return;
          latest.status = "failed";
          latest.run.finished_at = this.nowIso();
          if (latest.run.studio) {
            latest.run.studio.status = "failed";
            latest.run.studio.error = msg;
            latest.run.studio.last_synced_at = this.nowIso();
          }
          const step = latest.run.steps[latest.run.current_step_index];
          if (step) {
            step.status = "failed";
            step.summary = msg;
            step.finished_at = this.nowIso();
          }
          this.appendRunEvent(latest, {
            type: "run_finished",
            level: "error",
            message: `Studio 编排失败：${msg}`,
          });
          await this.write(latest);
        } catch (persistErr) {
          this.logger.error(
            `failed to persist studio error for ${workOrderId}: ${
              persistErr instanceof Error
                ? persistErr.message
                : String(persistErr)
            }`,
          );
        }
      }
    })();
    this.studioInFlight.set(
      workOrderId,
      run.finally(() => {
        if (this.studioInFlight.get(workOrderId) === run) {
          this.studioInFlight.delete(workOrderId);
        }
      }),
    );
  }

  async applyOutcome(
    order: WorkOrder,
    outcome: OrchestratorOutcome,
    bridgeBaseUrl: string,
  ): Promise<WorkOrder> {
    if (!order.run) throw new BadRequestException("run missing");
    const stamp = this.nowIso();
    const state = studioStateFromOutcome(outcome, bridgeBaseUrl);
    order.run.studio = {
      bridge_run_id: state.bridge_run_id || "",
      bridge_base_url: state.bridge_base_url || bridgeBaseUrl,
      current_stage: state.current_stage || "",
      last_summary: state.last_summary || "",
      pending_human: Boolean(state.pending_human),
      dry_run: Boolean(state.dry_run),
      status: state.status || outcome.kind,
      error: state.error ?? null,
      last_synced_at: stamp,
    };

    const idx = outcome.step_index;
    const step = order.run.steps[idx];
    const summary =
      outcome.kind === "failed"
        ? outcome.error
        : "summary" in outcome
          ? outcome.summary
          : state.last_summary || "";

    if (step) {
      step.summary = summary || step.summary;
      if ("stage_result" in outcome && outcome.stage_result) {
        step.output = outcome.stage_result.summary || step.output;
        step.output_title =
          step.output_title || step.label || outcome.stage_result.stage;
        const arts = outcome.stage_result.artifacts || [];
        if (arts.length) {
          const merged = new Set([...(step.artifact_paths || []), ...arts]);
          step.artifact_paths = [...merged];
        }
      }
    }

    if (outcome.kind === "pending_approval") {
      order.status = "pending_approval";
      order.run.current_step_index = idx;
      if (step) {
        step.status = "pending_approval";
        step.started_at = step.started_at || stamp;
      }
      this.appendRunEvent(order, {
        type: "human_input_required",
        message: `等待人工确认：${step?.label || step?.step_id || outcome.stage}`,
        step_id: step?.step_id,
        agent: step?.agent,
        detail: { stage: outcome.stage },
      });
      this.appendRunEvent(order, {
        type: "bridge_stage",
        message: summary || `stage ${outcome.stage}`,
        step_id: step?.step_id,
        agent: step?.agent,
      });
    } else if (outcome.kind === "running") {
      order.status = "running";
      order.run.current_step_index = idx;
      if (step) {
        step.status = "running";
        step.started_at = step.started_at || stamp;
      }
    } else if (outcome.kind === "completed") {
      for (const s of order.run.steps) {
        if (s.status !== "rejected") {
          s.status = "approved";
          s.finished_at = s.finished_at || stamp;
          s.summary = s.summary || "Studio 编排已完成";
        }
      }
      order.run.current_step_index = Math.max(0, order.run.steps.length - 1);
      order.status = "completed";
      this.appendRunEvent(order, {
        type: "run_finished",
        message: "当前仓流水线完成（Studio orchestrator）",
        dry_run: state.dry_run,
      });
      return this.orders.finishCurrentRepoAndContinue(order);
    } else if (outcome.kind === "rejected") {
      order.status = "rejected";
      order.run.finished_at = stamp;
      if (step) {
        step.status = "rejected";
        step.finished_at = stamp;
        step.feedback = summary;
      }
      this.appendRunEvent(order, {
        type: "run_finished",
        level: "warn",
        message: `运行结束：rejected${summary ? ` · ${summary}` : ""}`,
      });
    } else if (outcome.kind === "failed") {
      order.status = "failed";
      order.run.finished_at = stamp;
      if (step) {
        step.status = "failed";
        step.finished_at = stamp;
        step.summary = outcome.error;
      }
      this.appendRunEvent(order, {
        type: "run_finished",
        level: "error",
        message: `运行结束：failed · ${outcome.error}`,
      });
    }

    return this.write(order);
  }
}
