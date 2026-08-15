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
import { NotificationsService } from "../notifications/notifications.service";
import { RunLogsService } from "../run-logs/run-logs.service";
import { UsageService } from "../usage/usage.service";
import { AuditService } from "../audit/audit.service";
import {
  isTransientSummary,
  runStudioDecision,
  runStudioEvent,
  runStudioResume,
  runStudioStart,
  studioStateFromOutcome,
} from "./studio-orchestrator.adapter";
import { StudioJobEntity } from "./entities/studio-job.entity";
import { StudioJobsService } from "./studio-jobs.service";
import { WorkOrderAttachmentsService } from "./work-order-attachments.service";
import type {
  StudioJobDecidePayload,
  StudioJobEventPayload,
  StudioJobKind,
  StudioJobPayload,
  StudioJobPrepareStartPayload,
  StudioJobResumePayload,
  StudioJobStartPayload,
} from "./studio-job.types";
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
  action?: string;
  detail?: Record<string, unknown>;
  id?: string;
  at?: string;
};

/**
 * Studio orchestrator jobs (start / decide / resume) — keeps HTTP handlers thin.
 * Jobs are durable in `studio_jobs` and run inline (API) or by `worker.main`.
 */
@Injectable()
export class WorkOrderStudioRunner {
  private readonly logger = new Logger(WorkOrderStudioRunner.name);
  /** Local in-flight set for sync isBusy while a claimed job executes in this process. */
  private readonly studioInFlight = new Set<string>();

  constructor(
    private readonly humans: DigitalHumansService,
    private readonly runLogs: RunLogsService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly studioJobs: StudioJobsService,
    private readonly attachments: WorkOrderAttachmentsService,
    @Inject(forwardRef(() => WorkOrdersService))
    private readonly orders: WorkOrdersService,
  ) {}

  /** True while this process is executing a job, or a durable job is queued. */
  isBusy(workOrderId: string): boolean {
    return this.studioInFlight.has(workOrderId);
  }

  async isBusyAsync(workOrderId: string): Promise<boolean> {
    if (this.studioInFlight.has(workOrderId)) return true;
    return this.studioJobs.hasActiveJob(workOrderId);
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

  /** Best-effort: pull Bridge file bodies into MySQL so GC does not lose content. */
  private scheduleArtifactCapture(
    order: WorkOrder,
    paths: string[],
    stepId?: string,
  ) {
    const runId = (order.run?.run_id || "").trim();
    const list = (paths || []).map((p) => p.trim()).filter(Boolean);
    if (!runId || !list.length) return;
    void this.runLogs
      .captureArtifactsFromPaths({
        studio_run_id: runId,
        work_order_id: order.id,
        team_id: order.team_id || "",
        step_id: stepId || "",
        paths: list,
      })
      .then((r) => {
        if (r.captured > 0) {
          this.logger.log(
            `captured ${r.captured} artifact(s) for run ${runId} (skipped ${r.skipped})`,
          );
        }
      })
      .catch((err) => {
        this.logger.warn(
          `artifact capture failed for ${runId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /** Best-effort usage row (tokens optional until drivers emit them). */
  private scheduleUsageRecord(
    order: WorkOrder,
    stageResult: {
      stage?: string;
      driver?: string;
      dryRun?: boolean;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost_usd?: number;
      };
    } | null | undefined,
    stepId?: string,
  ) {
    if (!stageResult) return;
    void this.usage
      .record({
        team_id: order.team_id || "",
        work_order_id: order.id,
        run_id: order.run?.run_id || "",
        bridge_run_id: order.run?.studio?.bridge_run_id || "",
        step_id: stepId || "",
        stage: stageResult.stage || "",
        driver: stageResult.driver || "",
        prompt_tokens: stageResult.usage?.prompt_tokens,
        completion_tokens: stageResult.usage?.completion_tokens,
        total_tokens: stageResult.usage?.total_tokens,
        cost_usd: stageResult.usage?.cost_usd,
        dry_run: Boolean(stageResult.dryRun),
        detail: stageResult.usage ? { source: "stage_result.usage" } : null,
      })
      .catch((err) => {
        this.logger.warn(
          `usage record failed for ${order.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /**
   * Fast HTTP return: persist preparing run, then in background
   * ensure repos + Manager select, then orchestrate Bridge stages.
   */
  async startPreparingThenOrchestrate(
    previous: WorkOrder,
    draft: WorkOrder,
    opts: {
      agents_md_path?: string;
      bridge_base_url?: string;
      reuse_previous_routing?: boolean;
    },
  ): Promise<WorkOrder> {
    void previous;
    if (!draft.run) throw new BadRequestException("run missing");
    const bridgeBase =
      (opts.bridge_base_url || "").trim() ||
      draft.run.studio?.bridge_base_url ||
      "http://127.0.0.1:8787";
    const saved = await this.write(draft);
    const runId = saved.run!.run_id;

    this.enqueueTypedJob(saved.id, runId, "prepare_start", {
      agents_md_path: opts.agents_md_path,
      bridge_base_url: bridgeBase,
      reuse_previous_routing: Boolean(opts.reuse_previous_routing),
    });

    return saved;
  }

  /** Drive Bridge stages via `@agent-studio/orchestrator`. */
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
      ...draft.run.studio,
      bridge_run_id: draft.run.studio?.bridge_run_id || "",
      bridge_base_url: bridgeBase,
      bridge_id: draft.run.studio?.bridge_id || "",
      bridge_name: draft.run.studio?.bridge_name || "",
      bridge_driver: draft.run.studio?.bridge_driver || "",
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
    this.enqueueTypedJob(saved.id, saved.run!.run_id, "start", {
      bridge_base_url: bridgeBase,
      agents_md_path: agentsMdPath,
      routing_mode: routingMode,
      auto_approve: autoApprove,
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
    actor?: { user_id?: string; name?: string },
  ): Promise<WorkOrder> {
    let order = await this.get(id);
    if (
      order.status !== "pending_approval" &&
      !order.run?.studio?.pending_human
    ) {
      throw new BadRequestException("当前没有待确认的人工闸门");
    }
    const decision: "approve" | "reject" =
      body.decision === "reject" ||
      (!body.decision &&
        Boolean(body.action && /reject|驳回|拒绝/i.test(body.action)))
        ? "reject"
        : "approve";
    this.appendRunEvent(order, {
      type: "human_decision",
      message: `提交确认：${decision}${body.feedback ? ` · 反馈=${body.feedback}` : ""}`,
      action: decision,
      step_id: order.run?.steps[order.run.current_step_index]?.step_id,
      agent: order.run?.steps[order.run.current_step_index]?.agent,
      detail: {
        actor_user_id: actor?.user_id || "",
        actor_name: actor?.name || "",
      },
    });
    void this.audit
      .record({
        team_id: order.team_id || "",
        actor_user_id: actor?.user_id || "",
        actor_name: actor?.name || "unknown",
        action:
          decision === "reject"
            ? "work_order.reject"
            : "work_order.approve",
        resource_type: "work_order",
        resource_id: order.id,
        summary: `${decision} · ${order.title || order.id}`,
        detail: {
          decision,
          feedback: body.feedback || "",
          step_id: order.run?.steps[order.run.current_step_index]?.step_id,
        },
      })
      .catch((err) => {
        this.logger.warn(
          `audit decide failed: ${err instanceof Error ? err.message : String(err)}`,
        );
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
    this.enqueueTypedJob(saved.id, saved.run!.run_id, "decide", {
      decision,
      feedback,
      bridge_base_url: bridgeBase,
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
    this.enqueueTypedJob(order.id, runId, "resume", {
      feedback,
      bridge_base_url: bridgeBase,
    });
  }

  /**
   * Advance a wait_event step from Forge webhook / manual event.
   * Returns the saved order immediately; orchestrator continues in background.
   */
  async advanceFromEvent(
    id: string,
    opts: {
      event: "mr_merged" | "issue_labeled" | "manual";
      labels?: string[];
      feedback?: string;
    },
  ): Promise<WorkOrder> {
    let order = await this.get(id);
    if (order.status !== "waiting") {
      throw new BadRequestException(
        `工单不在 waiting 状态（当前: ${order.status}）`,
      );
    }
    const step = order.run?.steps[order.run.current_step_index];
    if (!step || (step.kind || "agent") !== "wait_event") {
      throw new BadRequestException("当前步骤不是 wait_event");
    }
    this.appendRunEvent(order, {
      type: "info",
      message: `收到事件 ${opts.event}，继续编排…`,
      step_id: step.step_id,
      agent: step.agent,
      detail: { event: opts.event, labels: opts.labels || [] },
    });
    if (order.run?.studio) {
      order.run.studio.status = "running";
      order.run.studio.last_summary = `事件 ${opts.event} 已到达，继续中…`;
      order.run.studio.last_synced_at = this.nowIso();
    }
    order.status = "running";
    step.status = "running";
    const saved = await this.write(order);
    const bridgeBase =
      saved.run?.studio?.bridge_base_url || "http://127.0.0.1:8787";
    this.enqueueTypedJob(saved.id, saved.run!.run_id, "event", {
      event: opts.event,
      labels: opts.labels,
      feedback: opts.feedback,
      bridge_base_url: bridgeBase,
    });
    return saved;
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
    const waiting = progress.state.status === "waiting";
    order.status = waiting ? "waiting" : "running";
    order.run.studio = {
      ...order.run.studio,
      bridge_run_id: state.bridge_run_id || "",
      bridge_base_url: state.bridge_base_url || bridgeBaseUrl,
      bridge_id: order.run.studio?.bridge_id || "",
      bridge_name: order.run.studio?.bridge_name || "",
      bridge_driver: order.run.studio?.bridge_driver || "",
      current_stage: progress.stage || state.current_stage || "",
      last_summary: progress.summary || state.last_summary || "",
      pending_human: false,
      dry_run: Boolean(state.dry_run),
      status: waiting ? "waiting" : "running",
      error: null,
      last_synced_at: stamp,
    };
    const prevIdx =
      typeof progress.from_step_index === "number"
        ? progress.from_step_index
        : order.run.current_step_index;
    const transition = progress.transition || "advance";
    order.run.current_step_index = progress.step_index;
    order.run.active_step_indices =
      transition === "parallel"
        ? progress.active_step_indices || []
        : [];

    // Leave prior step statuses correct on non-monotonic graph walks (goto / retry).
    if (
      typeof prevIdx === "number" &&
      prevIdx !== progress.step_index &&
      prevIdx >= 0 &&
      prevIdx < order.run.steps.length
    ) {
      const prev = order.run.steps[prevIdx]!;
      if (
        prev.status === "pending" ||
        prev.status === "running" ||
        prev.status === "pending_approval"
      ) {
        if (transition === "goto_reject") {
          prev.status = "rejected";
          prev.finished_at = stamp;
        } else if (transition === "advance" || transition === "parallel") {
          prev.status = "approved";
          prev.finished_at = prev.finished_at || stamp;
        }
      }
    }

    // Forward advance: mark any still-open steps before the cursor as approved
    // (auto-approve may skip intermediate progress events).
    if (transition === "advance" || transition === "start") {
      for (let i = 0; i < progress.step_index; i++) {
        const s = order.run.steps[i]!;
        if (s.status === "pending" || s.status === "running") {
          s.status = "approved";
          s.finished_at = s.finished_at || stamp;
        }
      }
    }

    if (transition === "parallel") {
      for (const i of order.run.active_step_indices) {
        const s = order.run.steps[i];
        if (!s) continue;
        if (s.status === "pending") {
          s.status = "running";
          s.started_at = s.started_at || stamp;
        }
      }
    }

    const cur = order.run.steps[progress.step_index];
    if (cur) {
      // Re-entering a step after goto/retry clears prior terminal stamp.
      if (transition === "goto_reject" || transition === "retry") {
        cur.finished_at = undefined;
      }
      const stageFailed =
        progress.stage_result?.status === "error" ||
        (transition === "parallel" &&
          progress.stage_result == null &&
          /failed|失败|error/i.test(progress.summary || ""));
      if (stageFailed) {
        cur.status = "failed";
        cur.finished_at = stamp;
      } else if (transition === "parallel" && progress.stage_result) {
        cur.status = "approved";
        cur.finished_at = stamp;
      } else if (waiting) {
        cur.status = "waiting";
      } else {
        cur.status = "running";
      }
      cur.started_at = cur.started_at || stamp;
      cur.summary = progress.summary || cur.summary;
      if (progress.stage_result?.summary) {
        cur.output = progress.stage_result.summary;
        cur.output_title = cur.output_title || cur.label || progress.stage;
      }
      const arts = progress.stage_result?.artifacts || [];
      if (arts.length) {
        const merged = new Set([...(cur.artifact_paths || []), ...arts]);
        cur.artifact_paths = [...merged];
        this.scheduleArtifactCapture(order, arts, cur.step_id);
      }
      this.scheduleUsageRecord(order, progress.stage_result, cur.step_id);
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

  /** Persist a durable job; worker (or inline API poller) claims and runs it. */
  enqueueTypedJob(
    workOrderId: string,
    runId: string,
    kind: StudioJobKind,
    payload: StudioJobPayload,
  ): void {
    void this.studioJobs
      .enqueue({
        work_order_id: workOrderId,
        run_id: runId,
        kind,
        payload,
      })
      .catch((err) => {
        this.logger.error(
          `enqueue ${kind} failed for ${workOrderId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  /** Execute a claimed `studio_jobs` row (called by StudioJobWorkerService). */
  async executeQueuedJob(job: StudioJobEntity): Promise<void> {
    const workOrderId = job.work_order_id;
    const runId = job.run_id;
    this.studioInFlight.add(workOrderId);
    try {
      const order = await this.get(workOrderId);
      if (order.run?.run_id !== runId) return;

      switch (job.kind as StudioJobKind) {
        case "prepare_start":
          await this.runPrepareStartJob(
            order,
            runId,
            job.payload as StudioJobPrepareStartPayload,
          );
          break;
        case "start":
          await this.runStartJob(
            order,
            job.payload as StudioJobStartPayload,
          );
          break;
        case "decide":
          await this.runDecideJob(
            order,
            job.payload as StudioJobDecidePayload,
          );
          break;
        case "resume":
          await this.runResumeJob(
            order,
            job.payload as StudioJobResumePayload,
          );
          break;
        case "event":
          await this.runEventJob(
            order,
            job.payload as StudioJobEventPayload,
          );
          break;
        default:
          throw new Error(`unknown studio job kind: ${job.kind}`);
      }
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
        this.notifications.scheduleWorkOrderEvent(latest, "failed", msg);
      } catch (persistErr) {
        this.logger.error(
          `failed to persist studio error for ${workOrderId}: ${
            persistErr instanceof Error
              ? persistErr.message
              : String(persistErr)
          }`,
        );
      }
      throw err;
    } finally {
      this.studioInFlight.delete(workOrderId);
    }
  }

  private async loadInboxFiles(workOrderId: string) {
    try {
      return await this.attachments.toInboxFiles(workOrderId);
    } catch (err) {
      this.logger.warn(
        `load inbox files for ${workOrderId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  private async runPrepareStartJob(
    order: WorkOrder,
    runId: string,
    opts: StudioJobPrepareStartPayload,
  ): Promise<void> {
    const bridgeBase =
      (opts.bridge_base_url || "").trim() ||
      order.run?.studio?.bridge_base_url ||
      "http://127.0.0.1:8787";
    try {
      if (order.run?.studio) {
        order.run.studio.status = "preparing";
        order.run.studio.last_summary = "正在 Bridge 上准备仓库…";
        order.run.studio.last_synced_at = this.nowIso();
      }
      this.appendRunEvent(order, {
        type: "info",
        message: "正在 Bridge 上准备仓库 / 总管选仓…",
      });
      await this.write(order);

      const routing = await this.orders.resolveStartRouting(order, {
        reusePrevious: Boolean(opts.reuse_previous_routing),
        agentsMdPath: opts.agents_md_path,
        bridgeBaseUrl: bridgeBase,
      });

      let latest = await this.get(order.id);
      if (latest.run?.run_id !== runId) return;
      if (!latest.run) return;

      const stamp = this.nowIso();
      const repoTargets = (routing.repo_targets || []).map((t, i) => ({
        ...t,
        status: i === 0 ? ("running" as const) : ("pending" as const),
        started_at: i === 0 ? stamp : undefined,
      }));
      latest.run.selected_repo_ids = routing.selected_repo_ids;
      latest.run.selected_agents_md_path = routing.agents_md_path;
      latest.run.manager_routing_reason = routing.manager_routing_reason;
      latest.run.repo_targets = repoTargets;
      latest.run.current_repo_index = 0;
      if (latest.run.studio) {
        latest.run.studio.status = "starting";
        latest.run.studio.bridge_base_url =
          latest.run.studio.bridge_base_url || bridgeBase;
        latest.run.studio.last_summary = "总管选仓完成，启动编排…";
        latest.run.studio.last_synced_at = stamp;
        latest.run.studio.error = null;
      }

      if (latest.project_id || repoTargets.length) {
        const orderLabel = repoTargets.length
          ? repoTargets.map((t, i) => `${i + 1}.${t.repo_id}`).join(" → ")
          : routing.selected_repo_ids.join(",") || "-";
        this.appendRunEvent(latest, {
          type: "info",
          message: `总管改仓计划（按序执行，减少返工）：${orderLabel}`,
          detail: {
            project_id: latest.project_id,
            selected_repo_ids: routing.selected_repo_ids,
            agents_md_path: routing.agents_md_path,
            reason: routing.manager_routing_reason,
            routing_mode: routing.routing_mode,
            repo_targets: repoTargets,
          },
        });
      }

      const first = latest.run.steps[0];
      if (first && first.status === "pending") {
        first.status = "running";
        first.started_at = stamp;
      }
      this.appendRunEvent(latest, {
        type: "info",
        message: "Studio 编排已提交（后台执行 Bridge 阶段，页面可刷新查看进度）",
      });
      latest = await this.write(latest);
      if (!latest.run || latest.run.run_id !== runId) return;

      const humans = await this.humans.list({ enabled: "all" });
      const agentsMdPath =
        routing.agents_md_path || opts.agents_md_path || "auto";
      const autoApprove = Boolean(latest.run.auto_approve);
      const outcome = await runStudioStart({
        order: latest,
        bridgeBaseUrl: bridgeBase,
        agentsMdPath,
        routingMode: routing.routing_mode,
        humans,
        autoApprove,
        inbox_files: await this.loadInboxFiles(latest.id),
        onProgress: async (progress) => {
          await this.persistProgress(latest.id, runId, progress, bridgeBase);
        },
      });
      const after = await this.get(order.id);
      if (after.run?.run_id !== runId) return;
      await this.applyOutcome(after, outcome, bridgeBase);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const latest = await this.get(order.id);
      if (!latest.run || latest.run.run_id !== runId) return;
      const stamp = this.nowIso();
      latest.status = "failed";
      latest.run.finished_at = stamp;
      latest.run.active_step_indices = [];
      if (latest.run.studio) {
        latest.run.studio.status = "failed";
        latest.run.studio.error = msg;
        latest.run.studio.last_summary = msg;
        latest.run.studio.pending_human = false;
        latest.run.studio.last_synced_at = stamp;
      }
      const step = latest.run.steps[latest.run.current_step_index];
      if (step) {
        step.status = "failed";
        step.summary = msg;
        step.finished_at = stamp;
      }
      this.appendRunEvent(latest, {
        type: "sync_error",
        level: "error",
        message: `准备失败：${msg}`,
      });
      this.appendRunEvent(latest, {
        type: "run_finished",
        level: "error",
        message: `运行结束：failed · ${msg}`,
      });
      await this.write(latest);
      this.notifications.scheduleWorkOrderEvent(latest, "failed", msg);
    }
  }

  private async runStartJob(
    order: WorkOrder,
    payload: StudioJobStartPayload,
  ): Promise<void> {
    const bridgeBase = payload.bridge_base_url;
    const humans = await this.humans.list({ enabled: "all" });
    const outcome = await runStudioStart({
      order,
      bridgeBaseUrl: bridgeBase,
      agentsMdPath: payload.agents_md_path,
      routingMode: payload.routing_mode,
      humans,
      autoApprove: payload.auto_approve,
      inbox_files: await this.loadInboxFiles(order.id),
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
  }

  private async runDecideJob(
    order: WorkOrder,
    payload: StudioJobDecidePayload,
  ): Promise<void> {
    const bridgeBase = payload.bridge_base_url;
    const humans = await this.humans.list({ enabled: "all" });
    const outcome = await runStudioDecision({
      order,
      decision: payload.decision,
      feedback: payload.feedback,
      humans,
      inbox_files: await this.loadInboxFiles(order.id),
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
  }

  private async runResumeJob(
    order: WorkOrder,
    payload: StudioJobResumePayload,
  ): Promise<void> {
    const bridgeBase = payload.bridge_base_url;
    const humans = await this.humans.list({ enabled: "all" });
    const outcome = await runStudioResume({
      order,
      feedback: payload.feedback,
      humans,
      inbox_files: await this.loadInboxFiles(order.id),
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
  }

  private async runEventJob(
    order: WorkOrder,
    payload: StudioJobEventPayload,
  ): Promise<void> {
    const bridgeBase = payload.bridge_base_url;
    const humans = await this.humans.list({ enabled: "all" });
    const outcome = await runStudioEvent({
      order,
      event: payload.event,
      labels: payload.labels,
      feedback: payload.feedback,
      humans,
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
      ...order.run.studio,
      bridge_run_id: state.bridge_run_id || "",
      bridge_base_url: state.bridge_base_url || bridgeBaseUrl,
      bridge_id: order.run.studio?.bridge_id || "",
      bridge_name: order.run.studio?.bridge_name || "",
      bridge_driver: order.run.studio?.bridge_driver || "",
      current_stage: state.current_stage || "",
      last_summary: isTransientSummary(state.last_summary)
        ? ""
        : state.last_summary || "",
      pending_human: Boolean(state.pending_human),
      dry_run: Boolean(state.dry_run),
      status: state.status || outcome.kind,
      error: state.error ?? null,
      last_synced_at: stamp,
    };

    const idx = outcome.step_index;
    const step = order.run.steps[idx];
    const rawSummary =
      outcome.kind === "failed"
        ? outcome.error
        : "summary" in outcome
          ? outcome.summary
          : state.last_summary || "";
    const summary = isTransientSummary(rawSummary) ? "" : rawSummary;

    if (step) {
      // A finishing outcome carries no fresh stage result: keep what the agent produced.
      const keepStepSummary =
        outcome.kind === "completed" && Boolean(step.summary?.trim());
      if (!keepStepSummary) step.summary = summary || step.summary;
      if ("stage_result" in outcome && outcome.stage_result) {
        const output = isTransientSummary(outcome.stage_result.summary)
          ? ""
          : outcome.stage_result.summary;
        step.output = output || step.output;
        step.output_title =
          step.output_title || step.label || outcome.stage_result.stage;
        const arts = outcome.stage_result.artifacts || [];
        if (arts.length) {
          const merged = new Set([...(step.artifact_paths || []), ...arts]);
          step.artifact_paths = [...merged];
          this.scheduleArtifactCapture(order, arts, step.step_id);
        }
        this.scheduleUsageRecord(order, outcome.stage_result, step.step_id);
      }
    }

    if (outcome.kind === "pending_approval") {
      order.status = "pending_approval";
      order.run.current_step_index = idx;
      order.run.active_step_indices = [];
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
      const saved = await this.write(order);
      this.notifications.scheduleWorkOrderEvent(
        saved,
        "pending_approval",
        step?.label || step?.step_id || outcome.stage,
      );
      return saved;
    } else if (outcome.kind === "waiting_event") {
      order.status = "waiting";
      order.run.current_step_index = idx;
      order.run.active_step_indices = [];
      if (step) {
        step.status = "waiting";
        step.started_at = step.started_at || stamp;
        step.summary = summary || step.summary;
      }
      this.appendRunEvent(order, {
        type: "info",
        message: `等待外部事件：${outcome.event}（${step?.label || step?.step_id || "wait_event"}）`,
        step_id: step?.step_id,
        agent: step?.agent,
        detail: { event: outcome.event, stage: outcome.stage },
      });
    } else if (outcome.kind === "running") {
      order.status = "running";
      order.run.current_step_index = idx;
      order.run.active_step_indices = [];
      if (step) {
        step.status = "running";
        step.started_at = step.started_at || stamp;
      }
    } else if (outcome.kind === "completed") {
      order.run.active_step_indices = [];
      for (const s of order.run.steps) {
        if (s.status === "rejected" || s.status === "failed") {
          continue;
        }
        if (s.status === "pending") {
          s.status = "skipped";
          s.finished_at = s.finished_at || stamp;
          s.summary = s.summary || "未执行（已跳过）";
          continue;
        }
        s.status = "approved";
        s.finished_at = s.finished_at || stamp;
        s.summary = s.summary || "Studio 编排已完成";
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
      order.run.active_step_indices = [];
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
      const saved = await this.write(order);
      this.notifications.scheduleWorkOrderEvent(
        saved,
        "failed",
        summary || "rejected",
      );
      return saved;
    } else if (outcome.kind === "failed") {
      order.status = "failed";
      order.run.finished_at = stamp;
      order.run.active_step_indices = [];
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
      const saved = await this.write(order);
      this.notifications.scheduleWorkOrderEvent(
        saved,
        "failed",
        outcome.error,
      );
      return saved;
    }

    return this.write(order);
  }
}
