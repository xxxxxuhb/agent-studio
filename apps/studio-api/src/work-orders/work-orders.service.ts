import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { In, type FindOptionsWhere, Repository } from "typeorm";
import {
  WorkOrderCreateSchema,
  WorkOrderDecisionSchema,
  WorkOrderRestartSchema,
  WorkOrderSchema,
  WorkOrderStartSchema,
  WorkOrderUpdateSchema,
  type WorkOrder,
  type WorkOrderCreate,
  type WorkOrderRepoTarget,
  type WorkOrderRunEvent,
  type WorkOrderRunStep,
  type WorkOrderUpdate,
} from "@agent-studio/agent-schema";
import { PipelinesService } from "../pipelines/pipelines.service";
import { DigitalHumansService } from "../digital-humans/digital-humans.service";
import { BridgesService } from "../bridges/bridges.service";
import { bridgeHttpToken } from "../bridges/bridge-http";
import { DifyClientService } from "../dify/dify-client.service";
import { DifyConfigService } from "../dify/dify-config.service";
import { ProjectsService } from "../projects/projects.service";
import { RealtimeHub } from "../realtime/realtime.hub";
import { RunLogsService } from "../run-logs/run-logs.service";
import { StudioConfigService } from "../studio-config/studio-config.service";
import { TeamsService } from "../teams/teams.service";
import {
  answersFromDefaults,
  formatOpenQuestionFeedback,
  parseOpenQuestions,
} from "@agent-studio/agent-schema";
import type { OrchestratorOutcome } from "@agent-studio/orchestrator";
import {
  runStudioDecision,
  runStudioStart,
  studioStateFromOutcome,
} from "./studio-orchestrator.adapter";
import {
  languageDirective,
  reviewCommitDirective,
} from "./agent-output";
import { WorkOrderEntity } from "./entities/work-order.entity";
import {
  type BridgeStageHint,
  type ProjectRouting,
  defaultDifyUserForWorkOrder,
  isHumanFormExpired,
  isInvalidOrExpiredHumanFormError,
  isTransientDifyFailure,
  explainDifyBridgeError,
  resolveDifyBridgeBase,
  resolveStudioBridgeBase,
  shouldClearFormTokenOnRemoteStatus,
} from "./work-order-dify-utils";
import {
  applyBridgeGitNote,
  bridgeGitEventMessage,
  parseBridgeGitNote,
} from "./work-order-bridge-git";
import {
  ensureWorkspaceViaBridge,
  prepareProjectRouting as prepareProjectRoutingFn,
} from "./work-order-routing";

export {
  isTransientDifyFailure,
  studioReachableBridgeBase,
} from "./work-order-dify-utils";
export { parseBridgeGitNote } from "./work-order-bridge-git";

/** Extract Bridge stage payload from Dify form/step text when present. */
export function parseBridgeStageHint(text: string): BridgeStageHint | null {
  if (!text) return null;
  const candidates: string[] = [];
  const httpMark = text.indexOf("HTTP 结果：");
  if (httpMark >= 0) {
    const rest = text.slice(httpMark + "HTTP 结果：".length).trim();
    const line = rest.split(/\n/)[0] || "";
    if (line.startsWith("{")) candidates.push(line);
  }
  const brace = text.indexOf('{"runId"');
  if (brace >= 0) {
    const slice = text.slice(brace);
    const end = slice.indexOf("}\n");
    candidates.push(end > 0 ? slice.slice(0, end + 1) : slice.slice(0, 2000));
  }
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as Record<string, unknown>;
      if (!obj || typeof obj !== "object") continue;
      const summary = String(obj.summary || obj.raw || "");
      const dryRun =
        /\[dry-run\]|dry-run|CURSOR_API_KEY missing|BRIDGE_DRY_RUN|Agent driver = dry-run/i.test(
          summary + JSON.stringify(obj).slice(0, 500),
        );
      return {
        runId: typeof obj.runId === "string" ? obj.runId : undefined,
        stage: typeof obj.stage === "string" ? obj.stage : undefined,
        status: typeof obj.status === "string" ? obj.status : undefined,
        summary: summary.slice(0, 240) || undefined,
        dryRun,
      };
    } catch {
      /* try next */
    }
  }
  if (/\[dry-run\]|CURSOR_API_KEY missing|BRIDGE_DRY_RUN/i.test(text)) {
    return { dryRun: true, summary: "detected dry-run markers in text" };
  }
  return null;
}

@Injectable()
export class WorkOrdersService implements OnModuleInit {
  private readonly logger = new Logger(WorkOrdersService.name);
  /** Prevent re-entrant auto-approve while decide→sync is in flight. */
  private readonly autoApproveInFlight = new Set<string>();
  /** Serialize syncDify per work order (web poll + gateway poll). */
  private readonly syncInFlight = new Map<string, Promise<WorkOrder>>();
  /** Studio orchestrator jobs (start/decide) — must not block HTTP. */
  private readonly studioInFlight = new Map<string, Promise<void>>();
  /** Dedupe agent form/body logs within process lifetime. */
  private readonly loggedBodies = new Set<string>();
  /** Serialize Bridge-idle queue admission per team. */
  private readonly admitLocks = new Set<string>();

  constructor(
    @InjectRepository(WorkOrderEntity)
    private readonly repo: Repository<WorkOrderEntity>,
    private readonly teams: TeamsService,
    private readonly pipelines: PipelinesService,
    private readonly humans: DigitalHumansService,
    private readonly difyClient: DifyClientService,
    private readonly difyConfig: DifyConfigService,
    private readonly projects: ProjectsService,
    private readonly runLogs: RunLogsService,
    private readonly realtime: RealtimeHub,
    private readonly studioConfig: StudioConfigService,
    private readonly bridges: BridgesService,
  ) {}

  onModuleInit() {
    this.bridges.onExecutorIdle((bridge) => {
      void this.tryAdmitQueued(bridge.team_id || "");
    });
  }

  private nowIso() {
    return new Date().toISOString();
  }

  private toWorkOrder(entity: WorkOrderEntity): WorkOrder {
    const run = this.normalizeRunPayload(entity.run ?? null);
    return WorkOrderSchema.parse({
      id: entity.id,
      team_id: entity.team_id || "",
      project_id: entity.project_id || "",
      title: entity.title,
      requirement: entity.requirement,
      status: entity.status,
      pipeline_id: entity.pipeline_id || "",
      category: entity.category || "requirement",
      priority: entity.priority || "medium",
      tags: entity.tags || [],
      clarifications: entity.clarifications || [],
      run,
      created_at: entity.created_at?.toISOString?.() || undefined,
      updated_at: entity.updated_at?.toISOString?.() || undefined,
    });
  }

  /** Soft-repair run JSON so one bad event cannot break work-order list. */
  private normalizeRunPayload(run: unknown): unknown {
    if (!run || typeof run !== "object") return run;
    const r = { ...(run as Record<string, unknown>) };
    if (Array.isArray(r.events)) {
      r.events = r.events.map((e, i) => {
        if (!e || typeof e !== "object") return e;
        const ev = { ...(e as Record<string, unknown>) };
        if (typeof ev.id !== "string" || !String(ev.id).trim()) {
          ev.id = `ev-fix-${i}-${randomUUID().slice(0, 8)}`;
        }
        if (typeof ev.at !== "string" || !ev.at) {
          ev.at = this.nowIso();
        }
        if (typeof ev.message !== "string") {
          ev.message = String(ev.message ?? "");
        }
        return ev;
      });
    }
    return r;
  }

  private toEntityFields(order: WorkOrder): Partial<WorkOrderEntity> {
    return {
      id: order.id,
      team_id: order.team_id || "",
      project_id: order.project_id || "",
      title: order.title,
      requirement: order.requirement,
      status: order.status,
      pipeline_id: order.pipeline_id || "",
      category: order.category || "requirement",
      priority: order.priority || "medium",
      tags: order.tags || [],
      clarifications: order.clarifications || [],
      run: order.run ?? null,
      created_at: order.created_at ? new Date(order.created_at) : undefined,
      updated_at: order.updated_at ? new Date(order.updated_at) : undefined,
    };
  }

  private appendRunEvent(
    order: WorkOrder,
    partial: {
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
    },
  ) {
    if (!order.run) return;
    const event: WorkOrderRunEvent = {
      id: partial.id || randomUUID().slice(0, 8),
      at: partial.at || this.nowIso(),
      type: partial.type,
      level: partial.level || "info",
      message: partial.message,
      step_id: partial.step_id,
      agent: partial.agent,
      bridge_stage: partial.bridge_stage,
      bridge_run_id: partial.bridge_run_id,
      dry_run: partial.dry_run,
      dify_status: partial.dify_status,
      action: partial.action,
      detail: partial.detail,
    };
    order.run.events = [...(order.run.events || []), event].slice(-200);
    const line = `[${order.id}] ${event.type}: ${event.message}`;
    if (event.level === "error") this.logger.error(line);
    else if (event.level === "warn") this.logger.warn(line);
    else this.logger.log(line);

    // Mirror into durable run-log store (keyed by run_id)
    const source =
      event.type === "bridge_stage"
        ? ("bridge" as const)
        : event.type.startsWith("dify_")
          ? ("dify" as const)
          : event.type === "human_decision" || event.type === "human_input_required"
            ? ("human" as const)
            : event.type === "step_mirrored"
              ? ("pipeline" as const)
              : event.type === "info" && /选仓|总管/.test(event.message)
                ? ("manager" as const)
                : ("system" as const);
    this.mirrorRunLog(order, {
      source,
      level:
        event.level === "warn"
          ? "warn"
          : event.level === "error"
            ? "error"
            : "info",
      message: event.message,
      step_id: event.step_id,
      agent: event.agent,
      bridge_stage: event.bridge_stage,
      event_type: event.type,
      detail: {
        ...(event.detail || {}),
        dry_run: event.dry_run,
        dify_status: event.dify_status,
        action: event.action,
        bridge_run_id: event.bridge_run_id,
      },
      id: `evt-${event.id}`,
      at: event.at,
    });
  }

  private mirrorRunLog(
    order: WorkOrder,
    partial: Parameters<RunLogsService["log"]>[1],
  ) {
    void this.runLogs.log(order, partial).catch((err) => {
      this.logger.error(
        `run-log mirror failed for ${order.id}/${order.run?.run_id || "-"}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  /** Parse Bridge hints from form/output and emit bridge_stage / dry-run warnings. */
  private noteBridgeHints(order: WorkOrder, text: string, step?: WorkOrderRunStep) {
    const hint = parseBridgeStageHint(text);
    if (!hint) {
      this.maybeNoteBridgeGit(order, text, step);
      return;
    }
    if (order.run?.dify) {
      if (hint.runId) order.run.dify.bridge_run_id = hint.runId;
      if (hint.dryRun) order.run.dify.bridge_dry_run = true;
    }
    const already = (order.run?.events || []).some(
      (e) =>
        e.type === "bridge_stage" &&
        e.bridge_stage === hint.stage &&
        e.bridge_run_id === hint.runId &&
        e.message === (hint.summary || `Bridge stage ${hint.stage || "?"}`),
    );
    if (!already && (hint.stage || hint.summary)) {
      this.appendRunEvent(order, {
        type: "bridge_stage",
        level: hint.dryRun ? "warn" : "info",
        message:
          hint.summary ||
          `Bridge stage ${hint.stage || "?"} · status=${hint.status || "-"}`,
        step_id: step?.step_id,
        agent: step?.agent,
        bridge_stage: hint.stage,
        bridge_run_id: hint.runId,
        dry_run: hint.dryRun,
        detail: { status: hint.status },
      });
    }
    if (hint.dryRun) {
      const warned = (order.run?.events || []).some(
        (e) => e.type === "warning" && e.dry_run === true,
      );
      if (!warned) {
        this.appendRunEvent(order, {
          type: "warning",
          level: "warn",
          message:
            "Bridge 处于 dry-run（未配置 CURSOR_API_KEY）：阶段会瞬间完成 stub，并未调用真实 Cursor Agent",
          dry_run: true,
          bridge_run_id: hint.runId,
        });
      }
    }
    this.maybeNoteBridgeGit(order, `${hint.summary || ""}\n${text}`, step);
  }

  /** When Bridge review stage reports review commit / Bridge MR, mirror into run.git. */
  private maybeNoteBridgeGit(order: WorkOrder, text: string, step?: WorkOrderRunStep) {
    const parsed = parseBridgeGitNote(text);
    if (!parsed || !order.run) return;
    const applied = applyBridgeGitNote(order, text, {
      stamp: this.nowIso(),
      step,
    });
    if (!applied) return;
    this.appendRunEvent(order, {
      type: "info",
      level: "info",
      message: bridgeGitEventMessage(parsed),
      step_id: step?.step_id,
      agent: step?.agent,
      detail: {
        commit_sha: parsed.sha,
        branch: parsed.branch,
        pr_url: parsed.prUrl || undefined,
      },
    });
  }

  async list(filters?: {
    status?: string;
    q?: string;
    team_ids?: string[];
  }): Promise<WorkOrder[]> {
    if (filters?.team_ids && filters.team_ids.length === 0) return [];
    const where: FindOptionsWhere<WorkOrderEntity> = {};
    if (filters?.team_ids) where.team_id = In(filters.team_ids);
    if (filters?.status && filters.status !== "all") {
      where.status = filters.status;
    }
    let items = (await this.repo.find({ where }))
      .map((e) => {
        try {
          return this.toWorkOrder(e);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`skip corrupt work order ${e.id}: ${msg}`);
          return null;
        }
      })
      .filter((w): w is WorkOrder => Boolean(w));
    if (filters?.q?.trim()) {
      const needle = filters.q.trim().toLowerCase();
      items = items.filter(
        (w) =>
          w.id.includes(needle) ||
          w.title.toLowerCase().includes(needle) ||
          w.requirement.toLowerCase().includes(needle) ||
          w.tags.some((t) => t.toLowerCase().includes(needle)),
      );
    }
    return items.sort((a, b) =>
      (b.updated_at || "").localeCompare(a.updated_at || ""),
    );
  }

  async listForUser(
    userId: string,
    filters?: { status?: string; q?: string; team_id?: string },
  ): Promise<WorkOrder[]> {
    const scoped = await this.teams.resolveScopedTeamIds(userId, filters?.team_id);
    return this.list({
      status: filters?.status,
      q: filters?.q,
      team_ids: scoped,
    });
  }

  async get(id: string): Promise<WorkOrder> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`not found: ${id}`);
    return this.toWorkOrder(entity);
  }

  async getForUser(userId: string, id: string): Promise<WorkOrder> {
    const order = await this.get(id);
    if (!(await this.userCanAccessWorkOrder(userId, order))) {
      throw new NotFoundException(`not found: ${id}`);
    }
    return order;
  }

  async requireWritableWorkOrder(
    userId: string,
    id: string,
  ): Promise<WorkOrder> {
    const order = await this.getForUser(userId, id);
    const teamId = (order.team_id || "").trim();
    if (!teamId) {
      throw new ForbiddenException("工单缺少 team_id，无法校验写权限");
    }
    await this.teams.requireWritableMember(teamId, userId);
    return order;
  }

  async userCanAccessWorkOrder(userId: string, order: WorkOrder): Promise<boolean> {
    let teamId = (order.team_id || "").trim();
    const projectId = (order.project_id || "").trim();
    if (!teamId) {
      // Empty project_id must NOT mean world-readable.
      if (!projectId) return false;
      try {
        const project = await this.projects.getById(projectId);
        teamId = (project.team_id || "").trim();
      } catch {
        return false;
      }
      if (!teamId) return false;
    }
    try {
      await this.teams.requireMember(teamId, userId);
    } catch {
      return false;
    }
    if (projectId) {
      return this.projects.userCanAccessProject(userId, projectId);
    }
    return true;
  }

  async createForUser(userId: string, input: WorkOrderCreate): Promise<WorkOrder> {
    let body: WorkOrderCreate;
    try {
      body = WorkOrderCreateSchema.parse(input);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    const exists = await this.repo.findOne({ where: { id: body.id } });
    if (exists) {
      throw new ConflictException(`already exists: ${body.id}`);
    }

    let teamId = (body.team_id || "").trim();
    const projectId = (body.project_id || "").trim();
    if (!teamId && projectId) {
      try {
        const project = await this.projects.getForUser(userId, projectId);
        teamId = project.team_id;
      } catch {
        throw new BadRequestException(`项目不存在或无权访问: ${projectId}`);
      }
    }
    if (!teamId) {
      throw new BadRequestException("创建工单需要 team_id（或绑定带团队的 project_id）");
    }
    await this.teams.requireWritableMember(teamId, userId);
    if (projectId) {
      await this.assertProjectBindingForUser(userId, projectId);
      const project = await this.projects.getById(projectId);
      if (project.team_id !== teamId) {
        throw new BadRequestException(
          `工单 team_id=${teamId} 与项目 team_id=${project.team_id} 不一致`,
        );
      }
    }

    return this.write(
      WorkOrderSchema.parse({
        ...body,
        team_id: teamId,
        project_id: projectId,
        status: body.status || "draft",
        run: null,
      }),
    );
  }

  async updateForUser(
    userId: string,
    id: string,
    patch: WorkOrderUpdate,
  ): Promise<WorkOrder> {
    const current = await this.requireWritableWorkOrder(userId, id);
    if (current.status === "running" || current.status === "pending_approval") {
      throw new BadRequestException("流水线进行中，无法编辑工单正文；请先结束或完成当前运行");
    }
    try {
      const parsed = WorkOrderUpdateSchema.parse(patch);
      if (parsed.project_id !== undefined) {
        await this.assertProjectBindingForUser(userId, parsed.project_id);
      }
      const merged = WorkOrderSchema.parse({
        ...current,
        ...parsed,
        id,
        team_id: current.team_id,
        run: current.run,
        status: current.status === "draft" ? current.status : current.status,
      });
      return this.write(merged);
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof ForbiddenException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  async update(id: string, patch: WorkOrderUpdate): Promise<WorkOrder> {
    const current = await this.get(id);
    if (current.status === "running" || current.status === "pending_approval") {
      throw new BadRequestException("流水线进行中，无法编辑工单正文；请先结束或完成当前运行");
    }
    try {
      const parsed = WorkOrderUpdateSchema.parse(patch);
      const merged = WorkOrderSchema.parse({
        ...current,
        ...parsed,
        id,
        run: current.run,
        status: current.status === "draft" ? current.status : current.status,
      });
      return this.write(merged);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  async remove(id: string) {
    const current = await this.get(id);
    if (current.status === "running" || current.status === "pending_approval") {
      throw new BadRequestException("流水线进行中，无法删除");
    }
    await this.repo.delete({ id });
    return { ok: true as const, id };
  }

  async removeForUser(userId: string, id: string) {
    await this.requireWritableWorkOrder(userId, id);
    return this.remove(id);
  }

  /** Append clarification note; allowed even while pipeline is running. */
  async clarify(id: string, note: string): Promise<WorkOrder> {
    const text = note.trim();
    if (!text) throw new BadRequestException("澄清内容不能为空");
    const order = await this.get(id);
    const stamp = this.nowIso();
    const clarifications = [...(order.clarifications || []), { at: stamp, note: text }];
    const requirement = `${order.requirement.trim()}\n\n## 澄清补充（${stamp}）\n${text}`;
    return this.write({
      ...order,
      clarifications,
      requirement,
    });
  }

  async clarifyForUser(userId: string, id: string, note: string): Promise<WorkOrder> {
    await this.requireWritableWorkOrder(userId, id);
    return this.clarify(id, note);
  }

  /** Jump back to a previous/named step and re-run (manager rework). */
  async rework(_id: string, _stepId: string, _feedback = ""): Promise<WorkOrder> {
    throw new BadRequestException(
      "暂不支持 Studio 返工；请在 Dify 控制台处理，或「同步 Dify」后重新执行",
    );
  }

  async reworkForUser(
    userId: string,
    id: string,
    stepId: string,
    feedback = "",
  ): Promise<WorkOrder> {
    await this.requireWritableWorkOrder(userId, id);
    return this.rework(id, stepId, feedback);
  }

  async describeStatus(id: string): Promise<string> {
    const order = await this.get(id);
    const lines = [
      `工单：${order.title} (\`${order.id}\`)`,
      `状态：${order.status}`,
      `类别：${order.category || "requirement"}`,
      `优先级：${order.priority}`,
    ];
    if (order.clarifications?.length) {
      lines.push(
        `澄清记录：${order.clarifications.length} 条（最近：${order.clarifications[order.clarifications.length - 1]?.note}）`,
      );
    }
    if (!order.run) {
      lines.push("流水线：未启动。可用「开始流水线」或告诉我要跑哪条模板。");
      return lines.join("\n");
    }
    const run = order.run;
    const step = run.steps[run.current_step_index];
    lines.push(
      `流水线：${run.pipeline_name} (\`${run.pipeline_id}\`) · run ${run.run_id} · executor=${run.executor || "dify"}`,
    );
    if (run.dify?.workflow_run_id) {
      lines.push(
        `Dify：status=${run.dify.status || "-"} · run=${run.dify.workflow_run_id}${run.dify.last_synced_at ? ` · synced ${run.dify.last_synced_at}` : ""}`,
      );
      if (run.dify.error) lines.push(`Dify 错误：${run.dify.error}`);
    }
    lines.push(
      `当前步骤：#${run.current_step_index + 1}/${run.steps.length} ${step?.label || step?.step_id || "-"}（agent: ${step?.agent || "-"}，状态: ${step?.status || "-"}）`,
    );
    lines.push("步骤一览：");
    for (const [i, s] of run.steps.entries()) {
      const mark = i === run.current_step_index ? "→" : " ";
      lines.push(`${mark} ${i + 1}. ${s.step_id} / ${s.agent} · ${s.status}`);
    }
    if (step?.summary) lines.push(`\n当前摘要：${step.summary}`);
    return lines.join("\n");
  }

  private async assertProjectBindingForUser(
    userId: string,
    projectId?: string,
  ) {
    const id = (projectId || "").trim();
    if (!id) return;
    try {
      const project = await this.projects.getForUser(userId, id);
      if (!project.enabled) {
        throw new BadRequestException(`项目已停用: ${id}`);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`项目不存在或无权访问: ${id}`);
    }
  }

  private async assertProjectBinding(projectId?: string) {
    const id = (projectId || "").trim();
    if (!id) return;
    try {
      const project = await this.projects.getById(id);
      if (!project.enabled) {
        throw new BadRequestException(`项目已停用: ${id}`);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`项目不存在: ${id}`);
    }
  }

  /**
   * Restart fast-path: reuse last run's manager repo plan (no Bridge Cursor call).
   * Still ensures clones exist on the Bridge host. Returns null when nothing usable.
   */
  private async tryReusePreviousRouting(
    order: WorkOrder,
    opts: { agentsMdPath?: string; bridgeBaseUrl?: string },
  ): Promise<ProjectRouting | null> {
    const prev = order.run;
    if (!prev) return null;

    const override = (opts.agentsMdPath || "").trim();
    if (override && override.toLowerCase() !== "auto") {
      // Explicit path from caller wins — fall through to prepareProjectRouting.
      return null;
    }

    const projectId = (order.project_id || "").trim();
    const prevTargets = (prev.repo_targets || []).filter((t) =>
      Boolean(t.agents_md_path?.trim()),
    );
    const prevIds = (prev.selected_repo_ids || []).filter(Boolean);

    if (!projectId) {
      const agents =
        prev.selected_agents_md_path?.trim() ||
        prevTargets[0]?.agents_md_path ||
        "";
      if (!agents || agents === "auto") return null;
      return {
        agents_md_path: agents,
        routing_mode: "explicit",
        selected_repo_ids: prevIds,
        manager_routing_reason:
          prev.manager_routing_reason ||
          "reuse previous routing (restart, no project)",
        repo_targets: prevTargets.length
          ? prevTargets.map((t, i) => ({
              ...t,
              status: i === 0 ? ("running" as const) : ("pending" as const),
              started_at: undefined,
              finished_at: undefined,
              bridge_run_id: "",
              dify_workflow_run_id: "",
              note: t.note || "reused from previous run",
            }))
          : [
              {
                repo_id: "manual",
                name: "manual",
                role: "",
                agents_md_path: agents,
                local_path: "",
                status: "running" as const,
                note: "reused previous agents_md_path",
                bridge_run_id: "",
                dify_workflow_run_id: "",
              },
            ],
      };
    }

    const project = await this.projects.getById(projectId);
    if (!project.enabled || !project.repos.length) return null;

    const bridgeBase = resolveStudioBridgeBase({
      override: opts.bridgeBaseUrl,
      registeredBaseUrl: await this.bridges.pickRegisteredBaseUrl({
        teamId: order.team_id,
      }),
      configured: this.difyConfig.getEffectiveForTeam(order.team_id || "")
        .bridge_base_url,
    });

    const catalog = await this.projects.catalogForManager(null, projectId);
    let ensured;
    try {
      ensured = await ensureWorkspaceViaBridge(
        { logger: this.logger },
        {
          bridgeBase,
          projectId,
          projectName: catalog.project_name,
          repos: catalog.repos.map((r) => ({
            id: r.id,
            remote_url: r.remote_url,
            name: r.name,
            role: r.role,
            default_branch: r.default_branch,
            note: r.note,
          })),
        },
      );
    } catch {
      return null;
    }

    const ready = ensured.filter((r) => r.clone_status === "ready");
    if (!ready.length) return null;

    const selectable = catalog.repos
      .map((r) => {
        const hit = ready.find((x) => x.id === r.id);
        if (!hit) return null;
        return {
          ...r,
          local_path: hit.local_path,
          agents_md_path: hit.agents_md_path,
        };
      })
      .filter((r): r is (typeof catalog.repos)[number] => Boolean(r));

    const orderedIds = (
      prevTargets.length ? prevTargets.map((t) => t.repo_id) : prevIds
    ).filter((id) => selectable.some((r) => r.id === id));

    if (!orderedIds.length) {
      this.logger.warn(
        `restart reuse routing skipped: previous repos not in ready catalog (${prevIds.join(",")})`,
      );
      return null;
    }

    const targets: WorkOrderRepoTarget[] = orderedIds.map((id, i) => {
      const meta = selectable.find((r) => r.id === id)!;
      const prevT = prevTargets.find((t) => t.repo_id === id);
      return {
        repo_id: meta.id,
        name: meta.name,
        role: meta.role,
        agents_md_path: meta.agents_md_path,
        local_path: meta.local_path,
        status: i === 0 ? ("running" as const) : ("pending" as const),
        note:
          prevT?.note ||
          prev.manager_routing_reason ||
          "reused from previous manager plan",
        bridge_run_id: "",
        dify_workflow_run_id: "",
      };
    });

    return {
      agents_md_path: targets[0]!.agents_md_path,
      routing_mode: "explicit",
      selected_repo_ids: targets.map((t) => t.repo_id),
      manager_routing_reason: `reuse previous manager plan (restart): ${
        prev.manager_routing_reason || orderedIds.join(" → ")
      }`,
      repo_targets: targets,
    };
  }

  /**
   * Ensure repos on Bridge, then ask Manager which repo(s) to change.
   */
  private async prepareProjectRouting(
    order: WorkOrder,
    opts: { agentsMdPath?: string; bridgeBaseUrl?: string },
  ): Promise<ProjectRouting> {
    return prepareProjectRoutingFn(
      {
        projects: this.projects,
        difyConfig: this.difyConfig,
        logger: this.logger,
        registeredBridgeBaseUrl: await this.bridges.pickRegisteredBaseUrl({
          teamId: order.team_id,
        }),
      },
      order,
      opts,
    );
  }

  async start(id: string, input: unknown): Promise<WorkOrder> {
    const body = WorkOrderStartSchema.parse(input);
    const order = await this.get(id);
    if (order.status === "running" || order.status === "pending_approval") {
      throw new BadRequestException(
        "工单已有进行中的流水线。请先点「结束运行」，或对总管说「驳回结束」后再启动。",
      );
    }
    const pipeline = await this.pipelines.get(body.pipeline_id);
    if (!pipeline.enabled) {
      throw new BadRequestException(`流水线已停用: ${pipeline.id}`);
    }

    const executor = body.executor === "dify" ? "dify" : "studio";
    if (executor === "dify") {
      // Validates global enabled + pipeline/global App Key
      this.difyConfig.resolveAuthForPipeline(pipeline);
    }

    const cfg = this.difyConfig.getEffectiveForTeam(order.team_id || "");
    const resolved = await this.bridges.resolveForNewRun({
      teamId: order.team_id,
      override: body.bridge_base_url,
      configured: cfg.bridge_base_url,
    });
    if (!resolved.ok) {
      if (resolved.reason === "busy_pool") {
        return this.enqueueForBridge(order, body, resolved.message);
      }
      throw new BadRequestException(resolved.message);
    }
    const bridgePick = {
      studioBaseUrl: resolved.studioBaseUrl,
      registeredBaseUrl: resolved.registeredBaseUrl,
    };
    const difyBridgeBase = resolveDifyBridgeBase({
      override: body.bridge_base_url,
      registeredBaseUrl: bridgePick.registeredBaseUrl,
      configured: cfg.bridge_base_url,
    });
    const studioBridgeBase = resolveStudioBridgeBase({
      override: body.bridge_base_url,
      registeredBaseUrl: bridgePick.registeredBaseUrl,
      configured: cfg.bridge_base_url,
    });

    let routing: ProjectRouting | null = null;
    if (body.reuse_previous_routing) {
      routing = await this.tryReusePreviousRouting(order, {
        agentsMdPath: body.agents_md_path,
        bridgeBaseUrl: body.bridge_base_url || bridgePick.studioBaseUrl,
      });
    }
    if (!routing) {
      routing = await this.prepareProjectRouting(order, {
        agentsMdPath: body.agents_md_path,
        bridgeBaseUrl: body.bridge_base_url || bridgePick.studioBaseUrl,
      });
    }

    const stamp = this.nowIso();
    const steps: WorkOrderRunStep[] = pipeline.steps.map((s) => ({
      step_id: s.id,
      agent: s.agent,
      label: s.label || s.id,
      human_approval: s.human_approval,
      on_reject: s.on_reject,
      reject_goto: s.reject_goto,
      status: "pending",
      summary: "",
      output: "",
      output_title: "",
      feedback: "",
    }));

    const repoTargets = (routing.repo_targets || []).map((t, i) => ({
      ...t,
      status: i === 0 ? ("running" as const) : ("pending" as const),
      started_at: i === 0 ? stamp : undefined,
    }));

    const autoApprove = Boolean(body.auto_approve);

    const next = WorkOrderSchema.parse({
      ...order,
      status: "running",
      pipeline_id: pipeline.id,
      run: {
        // 16 hex chars: 8-char prefixes collided and crashed run_logs INSERT.
        run_id: randomUUID().replace(/-/g, "").slice(0, 16),
        pipeline_id: pipeline.id,
        pipeline_name: pipeline.name,
        executor,
        auto_approve: autoApprove,
        current_step_index: 0,
        steps,
        events: [],
        started_at: stamp,
        selected_repo_ids: routing.selected_repo_ids,
        selected_agents_md_path: routing.agents_md_path,
        manager_routing_reason: routing.manager_routing_reason,
        repo_targets: repoTargets,
        current_repo_index: 0,
      },
    });
    this.appendRunEvent(next, {
      type: "run_started",
      message: `启动流水线 ${pipeline.name}（${pipeline.id}）· executor=${executor}${
        autoApprove ? " · 自动确认=开" : ""
      }`,
      detail: { pipeline_id: pipeline.id, executor, auto_approve: autoApprove },
    });
    if (order.project_id || repoTargets.length) {
      const orderLabel = repoTargets.length
        ? repoTargets.map((t, i) => `${i + 1}.${t.repo_id}`).join(" → ")
        : routing.selected_repo_ids.join(",") || "-";
      this.appendRunEvent(next, {
        type: "info",
        message: `总管改仓计划（按序执行，减少返工）：${orderLabel}`,
        detail: {
          project_id: order.project_id,
          selected_repo_ids: routing.selected_repo_ids,
          agents_md_path: routing.agents_md_path,
          reason: routing.manager_routing_reason,
          routing_mode: routing.routing_mode,
          repo_targets: repoTargets,
        },
      });
    }

    if (executor === "studio") {
      return this.startStudioFromDraft(order, next, {
        agents_md_path: routing.agents_md_path,
        routing_mode: routing.routing_mode,
        bridge_base_url: studioBridgeBase,
      });
    }

    return this.startDifyFromDraft(order, next, {
      agents_md_path: routing.agents_md_path,
      routing_mode: routing.routing_mode,
      bridge_base_url: difyBridgeBase,
    });
  }

  async startForUser(userId: string, id: string, input: unknown): Promise<WorkOrder> {
    await this.requireWritableWorkOrder(userId, id);
    return this.start(id, input);
  }

  /** Soft-queue a start until a team Bridge becomes idle (no Dify call yet). */
  private async enqueueForBridge(
    order: WorkOrder,
    body: ReturnType<typeof WorkOrderStartSchema.parse>,
    note: string,
  ): Promise<WorkOrder> {
    const stamp = this.nowIso();
    const pipeline = await this.pipelines.get(body.pipeline_id);
    const next = WorkOrderSchema.parse({
      ...order,
      status: "queued",
      pipeline_id: pipeline.id,
      run: {
        run_id: `q-${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        pipeline_id: pipeline.id,
        pipeline_name: pipeline.name,
        executor: body.executor === "dify" ? "dify" : "studio",
        auto_approve: Boolean(body.auto_approve),
        current_step_index: 0,
        steps: [],
        events: [],
        started_at: stamp,
        pending_start: {
          pipeline_id: body.pipeline_id,
          auto_approve: Boolean(body.auto_approve),
          agents_md_path: body.agents_md_path,
          bridge_base_url: body.bridge_base_url,
          reuse_previous_routing: Boolean(body.reuse_previous_routing),
          executor: body.executor === "dify" ? "dify" : "studio",
          enqueued_at: stamp,
          note,
        },
      },
    });
    this.appendRunEvent(next, {
      type: "info",
      level: "warn",
      message: note,
      detail: { queued: true, pipeline_id: pipeline.id },
    });
    this.logger.log(
      `work-order ${order.id} queued for idle Bridge (team=${order.team_id || "-"})`,
    );
    return this.write(next);
  }

  /** When a Bridge leaves busy→online, admit the oldest queued work order for that team. */
  async tryAdmitQueued(teamId: string): Promise<void> {
    const key = (teamId || "").trim() || "__unscoped__";
    if (this.admitLocks.has(key)) return;
    this.admitLocks.add(key);
    try {
      const idle = await this.bridges.pickRegisteredBaseUrl({
        teamId: teamId || undefined,
        preferIdle: true,
      });
      if (!idle) return;

      const rows = await this.repo.find({ where: { status: "queued" } });
      const candidates = rows
        .map((e) => this.toWorkOrder(e))
        .filter((w) => {
          if (!(w.run?.pending_start?.pipeline_id || "").trim()) return false;
          const wid = (w.team_id || "").trim();
          const tid = (teamId || "").trim();
          if (!tid) return !wid;
          return wid === tid || !wid;
        })
        .sort((a, b) => {
          const ae = a.run?.pending_start?.enqueued_at || a.run?.started_at || "";
          const be = b.run?.pending_start?.enqueued_at || b.run?.started_at || "";
          return ae.localeCompare(be);
        });
      const next = candidates[0];
      if (!next?.run?.pending_start) return;

      const pending = next.run.pending_start;
      this.logger.log(
        `admitting queued work-order ${next.id} on idle Bridge (team=${key})`,
      );
      try {
        await this.start(next.id, {
          pipeline_id: pending.pipeline_id,
          auto_approve: pending.auto_approve,
          agents_md_path: pending.agents_md_path,
          bridge_base_url: pending.bridge_base_url,
          reuse_previous_routing: pending.reuse_previous_routing,
          executor: pending.executor === "dify" ? "dify" : "studio",
        });
      } catch (err) {
        this.logger.warn(
          `failed to admit queued work-order ${next.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } finally {
      this.admitLocks.delete(key);
    }
  }

  /**
   * End the current run if active, then start a new one.
   * Defaults pipeline/executor from the last run — for soft-failed Dify runs, Bridge 503, etc.
   */
  async restart(id: string, input: unknown = {}): Promise<WorkOrder> {
    const body = WorkOrderRestartSchema.parse(input ?? {});
    const order = await this.get(id);
    const pipeline_id =
      body.pipeline_id?.trim() ||
      order.run?.pending_start?.pipeline_id ||
      order.run?.pipeline_id ||
      order.pipeline_id ||
      "";
    if (!pipeline_id) {
      throw new BadRequestException(
        "缺少 pipeline_id：请先指定流水线，或先跑过一次再「重新执行」",
      );
    }
    const executor = body.executor || order.run?.executor || "studio";

    if (order.status === "running" || order.status === "pending_approval") {
      await this.rejectAndEnd(
        id,
        body.feedback || "重新执行：结束旧运行",
      );
    } else if (order.status === "queued") {
      await this.cancelQueued(id, body.feedback || "重新执行：取消排队后重启");
    }

    // After rejectAndEnd the in-memory order is stale; reload so we can reuse routing.
    const latest = await this.get(id);
    return this.start(id, {
      pipeline_id,
      executor,
      auto_approve:
        body.auto_approve !== undefined
          ? body.auto_approve
          : Boolean(
              latest.run?.auto_approve ??
                latest.run?.pending_start?.auto_approve ??
                order.run?.auto_approve,
            ),
      agents_md_path: body.agents_md_path,
      bridge_base_url: body.bridge_base_url,
      // Default: reuse last manager plan (skip slow Cursor /routing/select).
      reuse_previous_routing: !body.reselect_repos,
    });
  }

  async restartForUser(
    userId: string,
    id: string,
    input: unknown = {},
  ): Promise<WorkOrder> {
    await this.requireWritableWorkOrder(userId, id);
    return this.restart(id, input);
  }

  /** Drive Bridge stages via `@agent-studio/orchestrator` (no Dify). */
  private async startStudioFromDraft(
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
    this.enqueueStudioJob(saved.id, saved.run!.run_id, async (order) => {
      const humans = await this.humans.list({ enabled: "all" });
      const outcome = await runStudioStart({
        order,
        bridgeBaseUrl: bridgeBase,
        agentsMdPath,
        routingMode,
        humans,
        autoApprove,
      });
      const latest = await this.get(order.id);
      if (latest.run?.run_id !== order.run?.run_id) return;
      await this.applyStudioOutcome(latest, outcome, bridgeBase);
    });
    return saved;
  }

  private async decideStudio(
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
    this.enqueueStudioJob(saved.id, saved.run!.run_id, async (current) => {
      const humans = await this.humans.list({ enabled: "all" });
      const outcome = await runStudioDecision({
        order: current,
        decision,
        feedback,
        humans,
      });
      const latest = await this.get(current.id);
      if (latest.run?.run_id !== current.run?.run_id) return;
      await this.applyStudioOutcome(latest, outcome, bridgeBase);
    });
    return saved;
  }

  /** Run Studio orchestrator off the request path; ignore if a newer run replaced it. */
  private enqueueStudioJob(
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
              persistErr instanceof Error ? persistErr.message : String(persistErr)
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

  private async applyStudioOutcome(
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
      return this.finishCurrentRepoAndContinue(order);
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

    const saved = await this.write(order);
    return this.maybeAutoApproveHumanGate(saved);
  }

  /** Call Dify first, then persist — avoids stuck running without remote binding. */
  private async startDifyFromDraft(
    previous: WorkOrder,
    draft: WorkOrder,
    opts: {
      agents_md_path?: string;
      routing_mode?: "auto" | "explicit";
      bridge_base_url?: string;
    },
  ): Promise<WorkOrder> {
    const cfg = this.difyConfig.getEffectiveForTeam(
      draft.team_id || previous.team_id || "",
    );
    const pipeline = await this.pipelines.get(draft.run!.pipeline_id);
    const auth = this.difyConfig.resolveAuthForPipeline(pipeline);
    const language = this.studioConfig.languageForTeam(
      draft.team_id || previous.team_id || "",
    );
    const user = defaultDifyUserForWorkOrder(draft.id);

    const agentManifest = await Promise.all(
      pipeline.steps.map(async (s) => {
        let human = null;
        try {
          human = await this.humans.get(s.agent);
        } catch {
          human = null;
        }
        return {
          step_id: s.id,
          label: s.label || s.id,
          agent_id: s.agent,
          agent_name: human?.name || s.agent,
          role: human?.role || "",
          human_approval: s.human_approval,
          dify_agent_id: human?.dify?.agent_id || "",
          dify_agent_name: human?.dify?.agent_name || "",
          may_commit: Boolean(human?.permissions?.may_commit),
          prompt_hints: human?.prompt_hints || [],
        };
      }),
    );

    const agentsMd =
      opts.agents_md_path ||
      draft.run?.selected_agents_md_path ||
      cfg.agents_md_path ||
      "auto";
    const routingMode =
      opts.routing_mode ||
      (agentsMd && agentsMd !== "auto" ? "explicit" : "auto");

    const inputs = {
      bridge_base_url: resolveDifyBridgeBase({
        override: opts.bridge_base_url,
        registeredBaseUrl: await this.bridges.pickRegisteredBaseUrl({
          teamId: draft.team_id || previous.team_id || "",
        }),
        configured: cfg.bridge_base_url,
      }),
      bridge_token: bridgeHttpToken(),
      agents_md_path: agentsMd,
      routing_mode: routingMode,
      language,
      locale: language === "zh" ? "zh-CN" : "en-US",
      commit_after_review: true,
      studio_pipeline_id: pipeline.id,
      studio_pipeline_name: pipeline.name,
      studio_run_id: draft.run?.run_id || "",
      studio_work_order_id: draft.id,
      studio_project_id: draft.project_id || "",
      studio_selected_repos: JSON.stringify(draft.run?.selected_repo_ids || []),
      studio_repo_plan: JSON.stringify(
        (draft.run?.repo_targets || []).map((t, i) => ({
          order: i + 1,
          repo_id: t.repo_id,
          role: t.role,
          status: t.status,
          agents_md_path: t.agents_md_path,
        })),
      ),
      studio_current_repo_index: String(draft.run?.current_repo_index ?? 0),
      studio_steps: JSON.stringify(
        pipeline.steps.map((s) => ({
          id: s.id,
          agent: s.agent,
          label: s.label,
          human_approval: s.human_approval,
          on_reject: s.on_reject,
          reject_goto: s.reject_goto,
        })),
      ),
      studio_agents: JSON.stringify(agentManifest),
      raw_requirement: [
        `【工单】${draft.title} (${draft.id})`,
        `【Studio run】${draft.run?.run_id || "-"}`,
        `【类别】${
          (
            {
              requirement: "需求",
              bug: "Bug",
              enhancement: "优化",
              chore: "杂项",
              other: "其他",
            } as Record<string, string>
          )[draft.category || "requirement"] || draft.category || "需求"
        } (${draft.category || "requirement"})`,
        draft.project_id
          ? `【Studio 项目】${draft.project_id}`
          : "",
        (draft.run?.repo_targets || []).length
          ? `【总管改仓顺序】${(draft.run?.repo_targets || [])
              .map((t, i) => `${i + 1}.${t.repo_id}(${t.role || "?"})`)
              .join(" → ")}`
          : draft.run?.selected_repo_ids?.length
            ? `【选仓】${draft.run.selected_repo_ids.join(",")}`
            : "",
        draft.run?.manager_routing_reason
          ? `【总管说明】${draft.run.manager_routing_reason}`
          : "",
        (() => {
          const targets = draft.run?.repo_targets || [];
          const idx = draft.run?.current_repo_index ?? 0;
          const cur = targets[idx];
          if (!cur) return "";
          return `【当前修改】第 ${idx + 1}/${targets.length} 仓：${cur.repo_id}（${cur.name || cur.role || ""}）\n【AGENTS.md】${cur.agents_md_path}`;
        })(),
        `【Studio 流水线】${pipeline.name} (${pipeline.id}) · Dify 绑定=${auth.source}`,
        "",
        languageDirective(language),
        "",
        reviewCommitDirective(language),
        "",
        "## Studio 步骤与数字人",
        ...agentManifest.map(
          (a, i) =>
            `${i + 1}. ${a.label} → agent=${a.agent_id}` +
            (a.dify_agent_id ? ` (dify:${a.dify_agent_id})` : "") +
            (a.role ? ` role=${a.role}` : ""),
        ),
        "",
        draft.requirement,
      ]
        .filter(Boolean)
        .join("\n"),
    };

    let started;
    try {
      const tokenSet = Boolean(String(inputs.bridge_token || "").trim());
      const pipelineAppId = pipeline.dify?.app_id?.trim() || "";
      const bindingEnabled = Boolean(pipeline.dify?.enabled);
      this.logger.log(
        `dify start ${draft.id}: bridge_base_url=${inputs.bridge_base_url} bridge_token=${tokenSet ? "set" : "EMPTY"} binding=${auth.source}` +
          (pipelineAppId
            ? ` pipeline_app_id=${pipelineAppId}${bindingEnabled ? "" : " (ignored: pipeline Dify binding disabled)"}`
            : ""),
      );
      if (pipelineAppId && !bindingEnabled && auth.source !== "pipeline") {
        this.logger.warn(
          `dify start ${draft.id}: pipeline has app_id=${pipelineAppId} but Dify binding is disabled; ` +
            `run uses ${auth.source} App Key (may be a different Dify app than the one DSL was imported into)`,
        );
      }
      if (!tokenSet) {
        throw new BadRequestException(
          "未配置 Bridge HTTP token（BRIDGE_HTTP_TOKEN / STUDIO_BRIDGE_TOKEN）。Dify 经 host.docker.internal 访问 Bridge 时会被鉴权拒绝，并常被误报为 SSRF。",
        );
      }
      started = await this.difyClient.startWorkflow({ inputs, user, auth });
    } catch (err) {
      // never persist running on failure
      void previous;
      throw err;
    }

    // Guard against false "succeeded" from node-level SSE status: confirm with getRun.
    if (
      started.workflow_run_id &&
      (started.status === "succeeded" ||
        started.status === "partial-succeeded" ||
        started.status === "failed" ||
        started.status === "stopped")
    ) {
      try {
        const detail = await this.difyClient.getRun(started.workflow_run_id, auth);
        if (detail.status) started.status = detail.status;
        if (detail.outputs) started.outputs = detail.outputs;
        if (detail.error !== undefined) started.error = detail.error;
      } catch {
        // keep SSE status
      }
    }

    if (!draft.run) throw new BadRequestException("run missing");
    draft.run.dify = {
      workflow_run_id: started.workflow_run_id,
      task_id: started.task_id,
      workflow_id: started.workflow_id || auth.workflow_id,
      status: started.status,
      error: started.error ?? null,
      outputs: started.outputs,
      inputs,
      user,
      form_token: started.form_token ?? null,
      form_node_title: started.form_node_title,
      binding_source: auth.source,
      api_base: auth.api_base,
      api_key_set: true,
      app_id: auth.app_id,
      last_synced_at: this.nowIso(),
      raw_summary: `Dify workflow started: ${started.workflow_run_id} (${started.status}) · binding=${auth.source}`,
    };

    await this.enrichDifyForm(draft);
    this.applyDifyStatusToOrder(draft, started.status);

    this.appendRunEvent(draft, {
      type: "dify_started",
      message: `Dify workflow_run=${started.workflow_run_id} status=${started.status} · binding=${auth.source}`,
      dify_status: started.status,
      detail: {
        workflow_run_id: started.workflow_run_id,
        task_id: started.task_id,
        bridge_base_url: inputs.bridge_base_url,
      },
    });
    if (draft.run.dify?.form_content) {
      this.noteBridgeHints(draft, draft.run.dify.form_content, draft.run.steps[0]);
    }
    if (started.status === "paused" || draft.run.dify?.form_token) {
      this.appendRunEvent(draft, {
        type: "human_input_required",
        message: `等待人工确认：${draft.run.dify?.form_node_title || "Human Input"}`,
        step_id: draft.run.steps[0]?.step_id,
        agent: draft.run.steps[0]?.agent,
        dify_status: "paused",
      });
    }

    this.mirrorDifySteps(draft, {
      phase: this.difyPhaseForOrder(draft),
      nodeTitle: draft.run.dify?.form_node_title,
    });

    if (draft.status === "failed" || draft.status === "cancelled") {
      draft.run.finished_at = this.nowIso();
      this.appendRunEvent(draft, {
        type: "run_finished",
        level: "error",
        message: `运行结束：${draft.status}${started.error ? ` · ${started.error}` : ""}`,
        dify_status: started.status,
      });
      return await this.write(draft);
    }

    const saved = await this.write(draft);
    if (saved.status === "completed") {
      saved.run!.finished_at = this.nowIso();
      this.appendRunEvent(saved, {
        type: "run_finished",
        message: "当前仓流水线完成（Dify succeeded）",
        dify_status: started.status,
      });
      return this.finishCurrentRepoAndContinue(saved);
    }
    return this.maybeAutoApproveHumanGate(saved);
  }

  private difyPhaseForOrder(
    order: WorkOrder,
  ): "running" | "pending_approval" | "completed" | "failed" {
    if (order.status === "pending_approval") return "pending_approval";
    if (order.status === "completed") return "completed";
    if (
      order.status === "failed" ||
      order.status === "cancelled" ||
      order.status === "rejected"
    ) {
      return "failed";
    }
    // Terminal remote failure should win even if Studio soft-held as running
    if (order.run?.dify?.status === "failed" || order.run?.dify?.status === "stopped") {
      return "failed";
    }
    return "running";
  }

  private isStudioRunTerminal(order: WorkOrder): boolean {
    return (
      order.status === "rejected" ||
      order.status === "cancelled" ||
      order.status === "failed" ||
      order.status === "completed"
    );
  }

  private isDifyRemoteTerminal(status: string): boolean {
    return shouldClearFormTokenOnRemoteStatus(status);
  }

  private async authForOrder(order: WorkOrder) {
    const pipelineId = order.run?.pipeline_id || order.pipeline_id;
    let pipeline = null;
    if (pipelineId) {
      try {
        pipeline = await this.pipelines.get(pipelineId);
      } catch {
        pipeline = null;
      }
    }
    return this.difyConfig.resolveAuthForPipeline(pipeline);
  }

  async syncDify(id: string): Promise<WorkOrder> {
    const existing = this.syncInFlight.get(id);
    // Join in-flight core sync, then auto-approve outside the lock.
    // Auto-approve → decide → syncDify must NOT run while syncInFlight still
    // holds this promise, or we deadlock and the work order stays "running".
    if (existing) {
      const order = await existing;
      return this.maybeAutoApproveHumanGate(order);
    }
    const pending = this.syncDifyUnlocked(id).finally(() => {
      this.syncInFlight.delete(id);
    });
    this.syncInFlight.set(id, pending);
    const order = await pending;
    return this.maybeAutoApproveHumanGate(order);
  }

  private async syncDifyUnlocked(id: string): Promise<WorkOrder> {
    const order = await this.get(id);
    if (!order.run?.dify?.workflow_run_id) {
      throw new BadRequestException("该工单没有绑定 Dify run");
    }
    const dify = order.run.dify;
    const workflowRunId = dify.workflow_run_id;
    if (!workflowRunId) {
      throw new BadRequestException("该工单没有绑定 Dify run");
    }

    const auth = await this.authForOrder(order);
    let detail;
    try {
      detail = await this.difyClient.getRun(workflowRunId, auth);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return await this.noteDifySyncRetry(order, msg);
    }

    // Only keep local end for explicit cancel/reject. A false "completed"
    // (misread SSE) must yield to remote running/paused on sync.
    if (
      (order.status === "rejected" || order.status === "cancelled") &&
      !this.isDifyRemoteTerminal(detail.status)
    ) {
      const keepStopped =
        dify.status === "stopped" ||
        order.status === "rejected" ||
        order.status === "cancelled";
      order.run.dify = {
        ...dify,
        error: detail.error ?? dify.error,
        outputs: detail.outputs || dify.outputs || {},
        last_synced_at: this.nowIso(),
        status: keepStopped ? "stopped" : dify.status,
        form_token: null,
        form_content: undefined,
        form_actions: undefined,
        form_inputs: undefined,
        raw_summary: `本地已结束（${order.status}）；远端 Dify 仍为 ${detail.status}，已忽略，不恢复运行`,
      };
      this.appendRunEvent(order, {
        type: "dify_status",
        level: "warn",
        message: `同步时保留本地结束状态（${order.status}），忽略远端 ${detail.status}`,
        dify_status: order.run.dify.status,
      });
      return await this.write(order);
    }

    const prevStatus = dify.status;
    let inputs: Record<string, unknown> | undefined = dify.inputs;
    if (typeof detail.inputs === "string" && detail.inputs) {
      try {
        inputs = JSON.parse(detail.inputs) as Record<string, unknown>;
      } catch {
        /* keep old */
      }
    } else if (detail.inputs && typeof detail.inputs === "object") {
      inputs = detail.inputs as Record<string, unknown>;
    }

    order.run.dify = {
      ...dify,
      workflow_run_id: detail.id || dify.workflow_run_id,
      workflow_id: detail.workflow_id || dify.workflow_id,
      status: detail.status,
      error: detail.error ?? null,
      outputs: detail.outputs || {},
      inputs,
      total_steps: detail.total_steps,
      elapsed_time: detail.elapsed_time ?? null,
      last_synced_at: this.nowIso(),
      // Preserve recovered token across running/paused flicker until terminal.
      form_token: dify.form_token,
      form_content: dify.form_content,
      form_actions: dify.form_actions,
      form_inputs: dify.form_inputs,
      form_expiration_time: dify.form_expiration_time,
      form_node_title: dify.form_node_title,
      raw_summary: `Dify status=${detail.status}; steps=${detail.total_steps ?? "-"}`,
    };

    if (detail.status === "paused" && !order.run.dify.user?.trim()) {
      order.run.dify.user = defaultDifyUserForWorkOrder(order.id);
    }

    if (
      detail.status === "paused" &&
      !order.run.dify.form_token &&
      order.run.dify.user
    ) {
      try {
        const recovered = await this.difyClient.recoverPauseInfo({
          workflowRunId: order.run.dify.workflow_run_id!,
          user: order.run.dify.user,
          auth,
        });
        if (recovered.form_token) {
          order.run.dify.form_token = recovered.form_token;
          order.run.dify.form_node_title =
            recovered.form_node_title || order.run.dify.form_node_title;
          order.run.dify.status = "paused";
          order.run.dify.raw_summary = `已从 Dify events 恢复 form_token；status=paused`;
          this.appendRunEvent(order, {
            type: "info",
            message: "已恢复 Human Input form_token",
            dify_status: "paused",
          });
        } else {
          const tip =
            "Dify 已暂停但暂未拿到 form_token（可能未开 Web App 投递，或 events 未回放门禁）。将继续自动同步。";
          order.run.dify.raw_summary = tip;
          const dupRecover = (order.run.events || []).some(
            (e) =>
              e.type === "sync_error" &&
              e.message.includes("暂未拿到 form_token"),
          );
          if (!dupRecover) {
            this.appendRunEvent(order, {
              type: "sync_error",
              level: "warn",
              message: tip,
              dify_status: "paused",
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const tip = `恢复 form_token 失败：${msg}`;
        order.run.dify.raw_summary = tip;
        const dupFail = (order.run.events || []).some(
          (e) =>
            e.type === "sync_error" &&
            e.message.startsWith("恢复 form_token 失败：") &&
            e.message === tip,
        );
        if (!dupFail) {
          this.appendRunEvent(order, {
            type: "sync_error",
            level: "warn",
            message: tip,
            dify_status: "paused",
          });
        }
      }
    }

    if (shouldClearFormTokenOnRemoteStatus(detail.status)) {
      order.run.dify.form_token = null;
      order.run.dify.form_content = undefined;
      order.run.dify.form_actions = undefined;
      order.run.dify.form_inputs = undefined;
      order.run.dify.form_expiration_time = undefined;
    } else if (
      detail.status === "paused" ||
      order.run.dify.status === "paused" ||
      order.run.dify.form_token
    ) {
      await this.enrichDifyForm(order);
    }

    if (prevStatus !== detail.status) {
      this.appendRunEvent(order, {
        type: "dify_status",
        level: detail.status === "failed" ? "error" : "info",
        message: `Dify 状态 ${prevStatus || "-"} → ${detail.status}${
          detail.error ? ` · ${detail.error}` : ""
        }`,
        dify_status: detail.status,
        step_id: order.run.steps[order.run.current_step_index]?.step_id,
        agent: order.run.steps[order.run.current_step_index]?.agent,
      });
    }

    const hintText = [
      order.run.dify.form_content || "",
      typeof detail.outputs?.result === "string" ? detail.outputs.result : "",
      detail.outputs ? JSON.stringify(detail.outputs) : "",
    ].join("\n");
    this.noteBridgeHints(
      order,
      hintText,
      order.run.steps[order.run.current_step_index],
    );

    if (
      (detail.status === "paused" || order.run.dify.status === "paused") &&
      order.run.dify.form_token
    ) {
      const title = order.run.dify.form_node_title || "Human Input";
      const dup = (order.run.events || []).some(
        (e) =>
          e.type === "human_input_required" &&
          e.message.includes(title) &&
          e.dify_status === "paused",
      );
      if (!dup) {
        this.appendRunEvent(order, {
          type: "human_input_required",
          message: `等待人工确认：${title}`,
          step_id: order.run.steps[order.run.current_step_index]?.step_id,
          agent: order.run.steps[order.run.current_step_index]?.agent,
          dify_status: "paused",
        });
      }
    }

    const softFailed =
      detail.status === "failed" &&
      isTransientDifyFailure(detail.error || "");
    const explainedError = explainDifyBridgeError(detail.error || "");

    this.applyDifyStatusToOrder(order, detail.status, {
      // Transient Bridge/network failures still end this run; mark retryable in summary.
      softFailed: false,
    });

    if (order.status === "running" || order.status === "pending_approval") {
      order.run.finished_at = undefined;
    }

    if (softFailed && order.run.dify) {
      order.run.dify.raw_summary = [
        "Dify 工作流已失败（下游瞬时错误，常见于 Bridge 鉴权失败被误报为 SSRF / Bridge 掉线）。",
        "本次 run 已结束；确认 Bridge 在线且 HTTP token 一致后点「重新执行」。",
        explainedError || "unknown error",
      ].join(" ");
    } else if (detail.status === "failed" && order.run.dify && !softFailed) {
      order.run.dify.raw_summary = [
        order.run.dify.raw_summary || "",
        explainedError ? `失败原因: ${explainedError}` : "",
        "修好问题后可点「重新执行」。",
      ]
        .filter(Boolean)
        .join(" ");
    }

    this.mirrorDifySteps(order, {
      phase: this.difyPhaseForOrder(order),
      nodeTitle: order.run.dify.form_node_title,
    });

    if (order.status === "completed") {
      order.run.finished_at = this.nowIso();
      const last = order.run.steps[order.run.steps.length - 1];
      if (last) {
        last.output_title = last.output_title || "Dify 最终输出";
        last.output = [
          last.output ? `${last.output}\n\n---\n` : "",
          "# Dify Outputs",
          "```json",
          JSON.stringify(detail.outputs || {}, null, 2),
          "```",
        ].join("\n");
      }
      this.appendRunEvent(order, {
        type: "run_finished",
        message: "当前仓流水线完成（Dify succeeded）",
        dify_status: detail.status,
        dry_run: order.run.dify?.bridge_dry_run,
      });
      return this.finishCurrentRepoAndContinue(order);
    } else if (order.status === "failed" || order.status === "cancelled") {
      order.run.finished_at = this.nowIso();
      const idx = order.run.current_repo_index ?? 0;
      const target = order.run.repo_targets?.[idx];
      if (target) {
        target.status = "failed";
        target.finished_at = this.nowIso();
      }
      this.appendRunEvent(order, {
        type: "run_finished",
        level: softFailed ? "warn" : "error",
        message: softFailed
          ? `运行结束（可重新执行）：Bridge/网络瞬时失败${explainedError ? ` · ${explainedError}` : ""}`
          : `运行结束：${order.status}${explainedError ? ` · ${explainedError}` : ""}`,
        dify_status: detail.status,
        detail: softFailed ? { retryable: true } : undefined,
      });
    }

    // Auto-approve runs in syncDify() after syncInFlight is cleared.
    return await this.write(order);
  }

  async syncDifyForUser(userId: string, id: string): Promise<WorkOrder> {
    // Sync is a mutating side-effect on remote/local run state — viewers cannot.
    await this.requireWritableWorkOrder(userId, id);
    return this.syncDify(id);
  }

  /**
   * When run.auto_approve is on, submit approve at human gates.
   * Pipeline steps keep human_approval=true; this only replaces the manual click.
   */
  private async maybeAutoApproveHumanGate(order: WorkOrder): Promise<WorkOrder> {
    if (!order.run?.auto_approve) return order;
    if (this.autoApproveInFlight.has(order.id)) return order;

    const waiting =
      order.status === "pending_approval" ||
      order.run.dify?.status === "paused" ||
      Boolean(order.run.studio?.pending_human);
    if (!waiting) return order;

    if (order.run.executor === "dify" && !order.run.dify?.form_token) {
      return order;
    }

    this.autoApproveInFlight.add(order.id);
    try {
      this.logger.log(`auto-approve human gate for ${order.id}`);
      const step = order.run.steps[order.run.current_step_index];
      const blob = [
        order.run.dify?.form_content || "",
        step?.output || "",
        ...order.run.steps.map((s) => s.output || ""),
      ].join("\n");
      const questions = parseOpenQuestions(blob);
      const feedback = questions.length
        ? formatOpenQuestionFeedback(
            answersFromDefaults(questions),
            "自动确认（采用默认）",
          )
        : "自动确认";
      if (questions.length) {
        try {
          await this.clarify(order.id, feedback);
        } catch {
          /* ignore clarify write failures during auto-approve */
        }
      }
      return await this.decide(order.id, {
        decision: "approve",
        feedback,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`auto-approve failed for ${order.id}: ${msg}`);
      try {
        const cur = await this.get(order.id);
        this.appendRunEvent(cur, {
          type: "info",
          level: "warn",
          message: `自动确认失败，仍需人工确认：${msg}`,
        });
        return await this.write(cur);
      } catch {
        return order;
      }
    } finally {
      this.autoApproveInFlight.delete(order.id);
    }
  }

  /** Persist a sync error without failing the work order (keeps running). */
  async noteDifySyncRetry(
    orderOrId: string | WorkOrder,
    message: string,
  ): Promise<WorkOrder> {
    const order =
      typeof orderOrId === "string" ? await this.get(orderOrId) : orderOrId;
    if (!order.run?.dify) {
      throw new BadRequestException("该工单没有绑定 Dify run");
    }
    const tip = isTransientDifyFailure(message)
      ? "拉取 Dify 状态失败（瞬时网络/网关），工单保持运行中，可稍后点「同步 Dify」重试。"
      : "拉取 Dify 状态失败，工单保持运行中，请稍后重试。";
    order.run.dify = {
      ...order.run.dify,
      // Mark as sync transport error; keep last known workflow status.
      error: `同步失败: ${message}`,
      last_synced_at: this.nowIso(),
      raw_summary: `${tip} ${message}`,
    };
    this.appendRunEvent(order, {
      type: "sync_error",
      level: "warn",
      message: `${tip} ${message}`,
      dify_status: order.run.dify.status,
    });
    if (
      order.status === "failed" ||
      order.status === "cancelled" ||
      order.status === "rejected" ||
      order.status === "completed"
    ) {
      // do not resurrect terminal states via sync noise
    } else if (order.status !== "pending_approval") {
      order.status = "running";
      order.run.finished_at = undefined;
    }
    return await this.write(order);
  }

  async decide(id: string, input: unknown): Promise<WorkOrder> {
    const body = WorkOrderDecisionSchema.parse(input);
    const order = await this.get(id);
    if (!order.run) throw new BadRequestException("工单尚未启动流水线");
    if (order.run.executor === "studio") {
      return this.decideStudio(id, body);
    }
    return this.decideDify(id, body);
  }

  async decideForUser(userId: string, id: string, input: unknown): Promise<WorkOrder> {
    await this.requireWritableWorkOrder(userId, id);
    return this.decide(id, input);
  }

  private async decideDify(
    id: string,
    body: {
      decision?: "approve" | "reject";
      action?: string;
      feedback?: string;
      inputs?: Record<string, unknown>;
    },
  ): Promise<WorkOrder> {
    let order = await this.get(id);
    if (order.status !== "pending_approval" && order.run?.dify?.status !== "paused") {
      throw new BadRequestException("当前没有待确认的 Dify Human Input");
    }
    if (!order.run?.dify?.form_token) {
      order = await this.syncDify(id);
    }
    let dify = order.run?.dify;
    if (!dify?.form_token) {
      throw new BadRequestException(
        "缺少 Dify form_token，无法在 Studio 确认。请先「同步 Dify」，并确认 Human Input 节点使用 Web App 投递。",
      );
    }
    if (!dify.user?.trim()) {
      dify.user = defaultDifyUserForWorkOrder(order.id);
      order.run!.dify!.user = dify.user;
      await this.write(order);
      dify = order.run?.dify;
    }
    if (!dify?.user) {
      throw new BadRequestException("缺少 Dify user，无法提交 Human Input");
    }
    if (isHumanFormExpired(dify.form_expiration_time)) {
      order.run!.dify!.form_token = null;
      order.run!.dify!.form_content = undefined;
      order.run!.dify!.raw_summary =
        "本地 form_token 已过期，正在重新同步 Dify Human Input…";
      await this.write(order);
      order = await this.syncDify(id);
      dify = order.run?.dify;
      if (!dify?.form_token) {
        throw new BadRequestException(
          "Human Input 表单已过期且未能重新获取 form_token，请点「同步 Dify」后重试",
        );
      }
    }

    const formToken = (dify.form_token || "").trim();
    const difyUser = (dify.user || "").trim();
    if (!formToken || !difyUser) {
      throw new BadRequestException(
        "缺少 Dify form_token 或 user，无法提交 Human Input",
      );
    }

    const action = this.resolveDifyAction(dify.form_actions || [], body);
    const inputs = this.buildDifyFormInputs(dify.form_inputs || [], body);
    const stepBefore = order.run?.steps[order.run.current_step_index];

    this.appendRunEvent(order, {
      type: "human_decision",
      message: `提交 Human Input：${action}${body.feedback ? ` · 反馈=${body.feedback}` : ""}`,
      action,
      step_id: stepBefore?.step_id,
      agent: stepBefore?.agent,
      dify_status: dify.status,
      detail: { node: dify.form_node_title },
    });
    await this.write(order);

    const auth = await this.authForOrder(order);
    try {
      await this.difyClient.submitHumanInputForm({
        formToken,
        action,
        user: difyUser,
        inputs,
        auth,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isInvalidOrExpiredHumanFormError(msg)) throw err;
      // Drop stale token, recover once, retry submit once.
      order = await this.get(id);
      if (order.run?.dify) {
        order.run.dify.form_token = null;
        order.run.dify.form_content = undefined;
        order.run.dify.form_actions = undefined;
        order.run.dify.form_inputs = undefined;
        order.run.dify.raw_summary = `提交失败（token 失效）：${msg}；正在重试恢复…`;
        this.appendRunEvent(order, {
          type: "sync_error",
          level: "warn",
          message: `Human Input 提交失败，尝试重新获取 form_token：${msg}`,
          dify_status: order.run.dify.status,
        });
        await this.write(order);
      }
      order = await this.syncDify(id);
      dify = order.run?.dify;
      const retryToken = (dify?.form_token || "").trim();
      const retryUser = (dify?.user || "").trim();
      if (!retryToken || !retryUser) {
        throw new BadRequestException(
          `Human Input 提交失败且无法恢复 form_token：${msg}`,
        );
      }
      await this.difyClient.submitHumanInputForm({
        formToken: retryToken,
        action,
        user: retryUser,
        inputs,
        auth: await this.authForOrder(order),
      });
    }

    order = await this.get(id);
    if (order.run?.dify) {
      order.run.dify.form_token = null;
      order.run.dify.form_content = undefined;
      order.run.dify.form_actions = undefined;
      order.run.dify.form_inputs = undefined;
      order.run.dify.status = "running";
      order.run.dify.raw_summary = `已提交 Human Input action=${action}`;

      const isReject = /reject|驳回|拒绝|deny|changes/i.test(action);
      const step = order.run.steps[order.run.current_step_index];
      if (step) {
        step.feedback = body.feedback || "";
        step.finished_at = this.nowIso();
        if (isReject || body.decision === "reject") {
          step.status = "rejected";
          step.summary = `已在 Studio 提交 Dify 确认：${action}`;
          // Dify may continue on reject branch — keep run alive until sync
          order.status = "running";
        } else {
          step.status = "approved";
          step.summary = `已在 Studio 提交 Dify 确认：${action}`;
          const nextIdx = order.run.current_step_index + 1;
          if (nextIdx < order.run.steps.length) {
            order.run.current_step_index = nextIdx;
            const next = order.run.steps[nextIdx];
            next.status = "running";
            next.started_at = this.nowIso();
            next.summary = "Dify 继续执行中";
            next.output_title = next.output_title || next.label || next.step_id;
          }
          order.status = "running";
        }
      } else {
        order.status = "running";
      }
      await this.write(order);
    }

    // Give Dify a moment, then sync
    await new Promise((r) => setTimeout(r, 800));
    return this.syncDify(id);
  }

  private resolveDifyAction(
    actions: Array<{ id: string; title?: string }>,
    body: { decision?: "approve" | "reject"; action?: string },
  ): string {
    if (body.action) {
      if (actions.length && !actions.some((a) => a.id === body.action)) {
        throw new BadRequestException(
          `未知 action: ${body.action}；可选：${actions.map((a) => a.id).join(", ")}`,
        );
      }
      return body.action;
    }
    const decision = body.decision || "approve";
    const byId = actions.find((a) => a.id.toLowerCase() === decision);
    if (byId) return byId.id;
    const byTitle = actions.find((a) =>
      (a.title || "").toLowerCase().includes(decision === "approve" ? "approv" : "reject"),
    );
    if (byTitle) return byTitle.id;
    if (decision === "approve") {
      return actions[0]?.id || "approve";
    }
    return (
      actions.find((a) => a.id !== actions[0]?.id)?.id ||
      actions[actions.length - 1]?.id ||
      "reject"
    );
  }

  private buildDifyFormInputs(
    fields: Array<{ type?: string; output_variable_name: string }>,
    body: { feedback?: string; inputs?: Record<string, unknown> },
  ): Record<string, unknown> {
    const inputs: Record<string, unknown> = { ...(body.inputs || {}) };
    const feedback = (body.feedback || "").trim();
    if (!feedback) return inputs;

    const preferred =
      fields.find((f) =>
        /feedback|comment|note|reason|意见|反馈|备注/i.test(f.output_variable_name),
      ) ||
      fields.find((f) => f.type === "paragraph" || f.type === "text-input") ||
      fields[0];

    if (preferred && inputs[preferred.output_variable_name] === undefined) {
      inputs[preferred.output_variable_name] = feedback;
    } else if (!fields.length && inputs.feedback === undefined) {
      inputs.feedback = feedback;
    }
    return inputs;
  }

  private async enrichDifyForm(order: WorkOrder) {
    const dify = order.run?.dify;
    if (!dify?.form_token) return;
    if (isHumanFormExpired(dify.form_expiration_time)) {
      dify.form_token = null;
      dify.form_content = undefined;
      dify.form_actions = undefined;
      dify.form_inputs = undefined;
      dify.form_expiration_time = undefined;
      dify.raw_summary = `${dify.raw_summary || ""}\n本地 form_token 已过期，将在下次同步时重新恢复`.trim();
      this.appendRunEvent(order, {
        type: "sync_error",
        level: "warn",
        message: "Human Input form_token 已过期，已清除并将重新恢复",
        dify_status: dify.status,
      });
      return;
    }
    try {
      const form = await this.difyClient.getHumanInputForm(
        dify.form_token,
        await this.authForOrder(order),
      );
      dify.form_content = form.form_content;
      dify.form_actions = (form.user_actions || []).map((a) => ({
        id: a.id,
        title: a.title,
        button_style: a.button_style,
      }));
      dify.form_inputs = (form.inputs || [])
        .filter((f) => f.output_variable_name)
        .map((f) => ({
          type: f.type,
          output_variable_name: f.output_variable_name,
        }));
      dify.form_expiration_time = form.expiration_time ?? null;
      if (isHumanFormExpired(dify.form_expiration_time)) {
        dify.form_token = null;
        dify.form_content = undefined;
        dify.form_actions = undefined;
        dify.form_inputs = undefined;
        dify.raw_summary = `${dify.raw_summary || ""}\n远端表单已过期`.trim();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dify.raw_summary = `${dify.raw_summary || ""}\n获取表单失败: ${msg}`.trim();
      if (isInvalidOrExpiredHumanFormError(msg)) {
        dify.form_token = null;
        dify.form_content = undefined;
        dify.form_actions = undefined;
        dify.form_inputs = undefined;
        dify.form_expiration_time = undefined;
        this.appendRunEvent(order, {
          type: "sync_error",
          level: "warn",
          message: `Human Input 表单不可用，已清除 token：${msg}`,
          dify_status: dify.status,
        });
      }
    }
  }

  private applyDifyStatusToOrder(
    order: WorkOrder,
    status: string,
    opts?: { softFailed?: boolean },
  ) {
    if (status === "paused") {
      order.status = "pending_approval";
    } else if (status === "running") {
      order.status = "running";
    } else if (status === "succeeded" || status === "partial-succeeded") {
      order.status = "completed";
    } else if (status === "failed") {
      if (opts?.softFailed) {
        order.status = "running";
      } else {
        order.status = "failed";
      }
    } else if (status === "stopped") {
      order.status = "cancelled";
    } else {
      order.status = "running";
    }
  }

  /**
   * Mirror Dify run phase onto Studio pipeline steps (best-effort).
   * Studio steps are a control-plane view; Dify owns real node execution.
   */
  private mirrorDifySteps(
    order: WorkOrder,
    opts: {
      phase: "running" | "pending_approval" | "completed" | "failed";
      nodeTitle?: string;
    },
  ) {
    const run = order.run;
    if (!run?.steps?.length) return;
    const steps = run.steps;

    if (opts.phase === "completed") {
      for (const step of steps) {
        if (step.status !== "rejected") {
          step.status = "approved";
          step.summary = step.summary || "Dify 运行已成功结束";
          step.finished_at = step.finished_at || this.nowIso();
        }
      }
      run.current_step_index = Math.max(0, steps.length - 1);
      this.mirrorRunLog(order, {
        source: "pipeline",
        message: "流水线全部步骤已完成（Dify succeeded）",
        event_type: "run_finished",
      });
      return;
    }

    if (opts.phase === "failed") {
      const cur = steps[run.current_step_index] || steps[steps.length - 1];
      if (cur) {
        const err = order.run?.dify?.error?.trim() || "";
        cur.status = "failed";
        cur.summary = err ? `Dify 失败：${err}` : "Dify 工作流失败";
        cur.feedback = err || cur.feedback || opts.phase;
        cur.finished_at = this.nowIso();
        cur.output_title = cur.output_title || order.run?.dify?.form_node_title || cur.label;
        cur.output = this.buildDifyStepOutput(order);
        this.mirrorRunLog(order, {
          source: "pipeline",
          level: "error",
          message: cur.summary,
          body: cur.output || "",
          step_id: cur.step_id,
          agent: cur.agent,
          event_type: "run_failed",
        });
      }
      for (let i = 0; i < steps.length; i++) {
        if (i === run.current_step_index) continue;
        if (steps[i].status === "running" || steps[i].status === "pending_approval") {
          steps[i].status = "pending";
          steps[i].finished_at = undefined;
        }
      }
      return;
    }

    let idx = run.current_step_index;
    const title = (opts.nodeTitle || "").trim().toLowerCase();
    if (title) {
      const found = steps.findIndex((s) => {
        const label = (s.label || "").toLowerCase();
        const id = s.step_id.toLowerCase();
        const agent = s.agent.toLowerCase();
        return (
          (label && (title.includes(label) || label.includes(title))) ||
          title === id ||
          title === agent ||
          title.includes(id) ||
          title.includes(agent)
        );
      });
      if (found >= 0) idx = found;
    }

    // Never move backward past an already approved chain unless matched earlier node
    for (let i = 0; i < idx; i++) {
      if (steps[i].status !== "rejected") {
        steps[i].status = "approved";
        if (!steps[i].summary) steps[i].summary = "Dify 已通过该阶段";
        steps[i].finished_at = steps[i].finished_at || this.nowIso();
      }
    }
    for (let i = idx + 1; i < steps.length; i++) {
      if (
        steps[i].status === "running" ||
        steps[i].status === "pending_approval"
      ) {
        steps[i].status = "pending";
      }
    }

    run.current_step_index = idx;
    const cur = steps[idx];
    if (!cur) return;

    if (opts.phase === "pending_approval") {
      const prevStatus = cur.status;
      cur.status = "pending_approval";
      cur.summary = "Dify 等待人工确认（可在 Studio 通过/驳回）";
      cur.output_title =
        order.run?.dify?.form_node_title || cur.output_title || cur.label;
      cur.output = this.buildDifyStepOutput(order);
      if (prevStatus !== "pending_approval") {
        this.mirrorRunLog(order, {
          source: "pipeline",
          message: `流水线步骤 ${cur.label || cur.step_id} → 待确认`,
          step_id: cur.step_id,
          agent: cur.agent,
          event_type: "step_mirrored",
          detail: { phase: opts.phase, nodeTitle: opts.nodeTitle },
        });
      }
      const form = order.run?.dify?.form_content || "";
      const formKey = `${order.run?.run_id}:form:${form.length}:${form.slice(0, 80)}`;
      if (form && !this.loggedBodies.has(formKey)) {
        this.loggedBodies.add(formKey);
        this.mirrorRunLog(order, {
          source: "agent",
          message: order.run?.dify?.form_node_title || "Dify Human Input / Agent 产出",
          body: form,
          step_id: cur.step_id,
          agent: cur.agent,
          event_type: "agent_output",
        });
      }
    } else {
      const prevStatus = cur.status;
      cur.status = "running";
      cur.summary = cur.summary || "Dify 执行中";
      cur.started_at = cur.started_at || this.nowIso();
      cur.output_title =
        order.run?.dify?.form_node_title || cur.output_title || cur.label;
      cur.output = this.buildDifyStepOutput(order);
      if (prevStatus !== "running") {
        this.mirrorRunLog(order, {
          source: "pipeline",
          message: `流水线步骤 ${cur.label || cur.step_id} → 执行中`,
          body: cur.output || "",
          step_id: cur.step_id,
          agent: cur.agent,
          event_type: "step_mirrored",
          detail: { phase: opts.phase, nodeTitle: opts.nodeTitle },
        });
      }
    }
  }

  private buildDifyStepOutput(order: WorkOrder): string {
    const dify = order.run?.dify;
    if (!dify) return "";
    const lines = [
      "# Dify Workflow",
      "",
      `- workflow_run_id: \`${dify.workflow_run_id || "-"}\``,
      `- task_id: \`${dify.task_id || "-"}\``,
      `- status: ${dify.status || "-"}`,
      `- form_token: ${dify.form_token ? "已就绪（可在 Studio 确认）" : "无"}`,
      "",
    ];
    if (dify.form_node_title) lines.push(`## ${dify.form_node_title}`, "");
    if (dify.form_content) {
      lines.push(dify.form_content, "");
    }
    if (dify.form_actions?.length) {
      lines.push(
        "## 可选操作",
        ...dify.form_actions.map((a) => `- \`${a.id}\` ${a.title || ""}`),
        "",
      );
    }
    if (dify.inputs) {
      lines.push(
        "## 启动输入",
        "```json",
        JSON.stringify(dify.inputs, null, 2),
        "```",
        "",
      );
    }
    lines.push(
      "> Human Input 可在 Studio 点「通过 / 驳回」；也可点「同步 Dify」刷新状态。",
    );
    return lines.join("\n");
  }

  /** Local stub executor removed — steps run via Dify Workflow. */
  runCurrentStep(_id: string): WorkOrder {
    throw new BadRequestException(
      "本地执行器已移除；请使用 Dify Workflow（「开始流水线」或「同步 Dify」）",
    );
  }

  /** Drop a Bridge soft-queue without calling Dify. */
  async cancelQueued(id: string, feedback = ""): Promise<WorkOrder> {
    const order = await this.get(id);
    if (order.status !== "queued") {
      throw new BadRequestException(`当前状态不是排队中: ${order.status}`);
    }
    const stamp = this.nowIso();
    const next = WorkOrderSchema.parse({
      ...order,
      status: "cancelled",
      run: order.run
        ? {
            ...order.run,
            finished_at: stamp,
            pending_start: undefined,
          }
        : null,
    });
    if (next.run) {
      this.appendRunEvent(next, {
        type: "run_finished",
        level: "info",
        message: `已取消 Bridge 排队：${feedback || "cancelQueued"}`,
      });
    }
    return this.write(next);
  }

  /** Force-end current run and stop the active Dify workflow when present. */
  async rejectAndEnd(id: string, feedback = ""): Promise<WorkOrder> {
    const order = await this.get(id);
    if (order.status === "queued") {
      return this.cancelQueued(id, feedback || "取消 Bridge 排队");
    }
    if (!order.run) throw new BadRequestException("工单尚未启动流水线");
    if (order.status !== "running" && order.status !== "pending_approval") {
      throw new BadRequestException(`当前状态不可驳回结束: ${order.status}`);
    }

    const dify = order.run.dify;
    let difyStopDetail = "";
    if (dify) {
      const auth = await this.authForOrder(order);
      const user = (dify.user || "").trim() || `wo-${order.id}`;
      const stop = await this.difyClient.stopWorkflow({
        taskId: dify.task_id,
        workflowRunId: dify.workflow_run_id,
        user,
        auth,
      });
      difyStopDetail = stop.detail;
      this.appendRunEvent(order, {
        type: "dify_status",
        level: stop.ok ? "info" : "warn",
        message: stop.ok
          ? `已停掉当前 Dify 流程：${stop.detail}`
          : `结束运行时停 Dify 失败：${stop.detail}`,
        dify_status: stop.ok ? "stopped" : dify.status,
      });
    }

    const run = order.run;
    const step = run.steps[run.current_step_index];
    if (step) {
      step.status = "rejected";
      step.feedback = feedback || "总管驳回并结束本轮";
      step.finished_at = this.nowIso();
    }
    order.status = "rejected";
    run.finished_at = this.nowIso();
    const idx = run.current_repo_index ?? 0;
    const target = run.repo_targets?.[idx];
    if (target && (target.status === "running" || target.status === "pending")) {
      target.status = "failed";
      target.finished_at = this.nowIso();
    }
    if (dify) {
      dify.status = "stopped";
      dify.form_token = null;
      dify.form_content = undefined;
      dify.form_actions = undefined;
      dify.form_inputs = undefined;
      dify.raw_summary = [
        `本地结束运行：${feedback || "rejectAndEnd"}`,
        difyStopDetail ? `Dify: ${difyStopDetail}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    this.appendRunEvent(order, {
      type: "run_finished",
      level: "warn",
      message: `手动结束运行：${feedback || "rejectAndEnd"}${
        difyStopDetail ? ` · ${difyStopDetail}` : ""
      }`,
      dify_status: "stopped",
    });
    return await this.write(order);
  }

  async rejectAndEndForUser(
    userId: string,
    id: string,
    feedback = "",
  ): Promise<WorkOrder> {
    await this.requireWritableWorkOrder(userId, id);
    return this.rejectAndEnd(id, feedback);
  }

  /**
   * After one repo's pipeline succeeds: mark it done and start the next
   * Manager-ordered target (or complete the work order).
   */
  private async finishCurrentRepoAndContinue(order: WorkOrder): Promise<WorkOrder> {
    const prepared = await this.markCurrentRepoCompleted(order);
    if (prepared.done) return await this.write(prepared.order);

    const saved = await this.write(prepared.order);
    const cfg = this.difyConfig.getEffectiveForTeam(saved.team_id || "");
    const registered = await this.bridges.pickRegisteredBaseUrl({
      teamId: saved.team_id,
    });
    const executor = saved.run?.executor === "dify" ? "dify" : "studio";
    if (executor === "studio") {
      return this.startStudioFromDraft(saved, saved, {
        agents_md_path: saved.run?.selected_agents_md_path,
        routing_mode: "explicit",
        bridge_base_url: resolveStudioBridgeBase({
          registeredBaseUrl: registered,
          configured: cfg.bridge_base_url,
        }),
      });
    }
    return this.startDifyFromDraft(saved, saved, {
      agents_md_path: saved.run?.selected_agents_md_path,
      routing_mode: "explicit",
      bridge_base_url: resolveDifyBridgeBase({
        registeredBaseUrl: registered,
        configured: cfg.bridge_base_url,
      }),
    });
  }

  private async markCurrentRepoCompleted(order: WorkOrder): Promise<{
    order: WorkOrder;
    done: boolean;
  }> {
    const run = order.run!;
    const targets = run.repo_targets || [];
    const stamp = this.nowIso();
    const idx = run.current_repo_index ?? 0;

    if (!targets.length) {
      order.status = "completed";
      run.finished_at = stamp;
      this.appendRunEvent(order, {
        type: "run_finished",
        message: "运行完成（无多仓队列）",
      });
      return { order, done: true };
    }

    const cur = targets[idx];
    if (cur) {
      cur.status = "completed";
      cur.finished_at = stamp;
      if (run.dify?.workflow_run_id) {
        cur.dify_workflow_run_id = run.dify.workflow_run_id;
      }
      if (run.dify?.bridge_run_id) {
        cur.bridge_run_id = run.dify.bridge_run_id;
      }
      this.appendRunEvent(order, {
        type: "info",
        message: `仓 ${cur.repo_id} 已完成（${idx + 1}/${targets.length}）`,
        detail: { repo_id: cur.repo_id, index: idx },
      });
    }

    const nextIdx = idx + 1;
    if (nextIdx >= targets.length) {
      order.status = "completed";
      run.finished_at = stamp;
      this.appendRunEvent(order, {
        type: "run_finished",
        message: `全部仓库按序完成：${targets.map((t) => t.repo_id).join(" → ")}`,
      });
      return { order, done: true };
    }

    const nextTarget = targets[nextIdx]!;
    run.current_repo_index = nextIdx;
    nextTarget.status = "running";
    nextTarget.started_at = stamp;
    run.selected_agents_md_path = nextTarget.agents_md_path;
    run.finished_at = undefined;
    order.status = "running";

    let pipelineSteps = run.steps;
    try {
      pipelineSteps = (await this.pipelines.get(run.pipeline_id)).steps.map(
        (s) => ({
          step_id: s.id,
          agent: s.agent,
          label: s.label || s.id,
          human_approval: s.human_approval,
          on_reject: s.on_reject,
          reject_goto: s.reject_goto,
          status: "pending" as const,
          summary: "",
          output: "",
          output_title: "",
          feedback: "",
        }),
      );
    } catch {
      pipelineSteps = run.steps.map((s) => ({
        ...s,
        status: "pending" as const,
        summary: "",
        output: "",
        output_title: "",
        feedback: "",
        started_at: undefined,
        finished_at: undefined,
      }));
    }
    run.steps = pipelineSteps;
    run.current_step_index = 0;
    run.dify = undefined;

    this.appendRunEvent(order, {
      type: "info",
      message: `按总管顺序开始下一仓 ${nextIdx + 1}/${targets.length}：${nextTarget.repo_id}`,
      detail: {
        repo_id: nextTarget.repo_id,
        agents_md_path: nextTarget.agents_md_path,
        plan: targets.map((t) => t.repo_id),
      },
    });

    return { order, done: false };
  }

  private async write(order: WorkOrder): Promise<WorkOrder> {
    const stamp = this.nowIso();
    const existing = await this.repo.findOne({ where: { id: order.id } });
    const next = WorkOrderSchema.parse({
      ...order,
      created_at:
        order.created_at || existing?.created_at?.toISOString?.() || stamp,
      updated_at: stamp,
    });
    if (!next.team_id?.trim()) {
      throw new BadRequestException("work order team_id is required");
    }
    await this.repo.save(this.toEntityFields(next) as WorkOrderEntity);
    await this.runLogs.touchFromOrder(next);
    this.realtime.publishWorkOrder(next);
    return next;
  }
}
