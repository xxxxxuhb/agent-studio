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
  AgentChatPostSchema,
  parseAgentMentions,
  WorkOrderCreateSchema,
  WorkOrderDecisionSchema,
  WorkOrderRestartSchema,
  WorkOrderSchema,
  WorkOrderStartSchema,
  WorkOrderUpdateSchema,
  type AgentChatMessage,
  type AgentChatThread,
  type WorkOrder,
  type WorkOrderCreate,
  type WorkOrderRepoTarget,
  type WorkOrderRunEvent,
  type WorkOrderRunStep,
  type WorkOrderUpdate,
} from "@agent-studio/agent-schema";
import { bridgeStageForAgent } from "@agent-studio/orchestrator";
import { PipelinesService } from "../pipelines/pipelines.service";
import { DigitalHumansService } from "../digital-humans/digital-humans.service";
import { BridgesService } from "../bridges/bridges.service";
import { ProjectsService } from "../projects/projects.service";
import { RealtimeHub } from "../realtime/realtime.hub";
import { RunLogsService } from "../run-logs/run-logs.service";
import { StudioConfigService } from "../studio-config/studio-config.service";
import { TeamsService } from "../teams/teams.service";
import type { OrchestratorOutcome, OrchestratorProgress } from "@agent-studio/orchestrator";
import {
  agentLookup,
  makeBridgeClient,
  runStudioDecision,
  runStudioStart,
  studioStateFromOutcome,
} from "./studio-orchestrator.adapter";
import {
  appendAgentChatMessages,
  loadAgentChatThread,
} from "./agent-chat.store";
import { WorkOrderEntity } from "./entities/work-order.entity";
import {
  type ProjectRouting,
  resolveStudioBridgeBase,
  studioReachableBridgeBase,
} from "./work-order-bridge-utils";
import {
  ensureWorkspaceViaBridge,
  prepareProjectRouting as prepareProjectRoutingFn,
} from "./work-order-routing";

export { studioReachableBridgeBase } from "./work-order-bridge-utils";
export { parseBridgeGitNote } from "./work-order-bridge-git";

@Injectable()
export class WorkOrdersService implements OnModuleInit {
  private readonly logger = new Logger(WorkOrdersService.name);
  /** Studio orchestrator jobs (start/decide) — must not block HTTP. */
  private readonly studioInFlight = new Map<string, Promise<void>>();
  /** Serialize Bridge-idle queue admission per team. */
  private readonly admitLocks = new Set<string>();

  constructor(
    @InjectRepository(WorkOrderEntity)
    private readonly repo: Repository<WorkOrderEntity>,
    private readonly teams: TeamsService,
    private readonly pipelines: PipelinesService,
    private readonly humans: DigitalHumansService,
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

  async getAgentChat(id: string): Promise<AgentChatThread> {
    await this.get(id);
    return loadAgentChatThread(id);
  }

  async getAgentChatForUser(
    userId: string,
    id: string,
  ): Promise<AgentChatThread> {
    await this.getForUser(userId, id);
    return this.getAgentChat(id);
  }

  /**
   * Ad-hoc @digital-human chat: Bridge executeStage with user message as feedback.
   * Does not advance Studio pipeline steps / auto-approve.
   */
  async postAgentChat(
    id: string,
    body: unknown,
  ): Promise<{ thread: AgentChatThread; order: WorkOrder }> {
    let message: string;
    try {
      message = AgentChatPostSchema.parse(body).message;
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
    const text = message.trim();
    if (!text) throw new BadRequestException("消息不能为空");

    if (this.studioInFlight.has(id)) {
      throw new ConflictException(
        "Studio 编排正在执行，请稍后再 @ 数字人",
      );
    }

    const order = await this.get(id);
    const bridgeRunId = order.run?.studio?.bridge_run_id?.trim() || "";
    if (!order.run || !bridgeRunId) {
      throw new BadRequestException("请先启动流水线后再 @ 数字人聊天");
    }

    const humans = (await this.humans.list({ enabled: "true" })).filter(
      (h) => !order.team_id || h.team_id === order.team_id,
    );
    const mentions = parseAgentMentions(text, humans);
    if (!mentions.primary) {
      throw new BadRequestException(
        "请 @ 一个已启用的数字人（例如 @fullstack_dev）后再发送",
      );
    }

    const primary = mentions.primary;
    const lookup = agentLookup(humans);
    const human = lookup.get(primary.id);
    const stage = bridgeStageForAgent(human || null, primary.id);
    const stamp = this.nowIso();
    const userMsg: AgentChatMessage = {
      id: randomUUID().slice(0, 8),
      role: "user",
      content: text,
      created_at: stamp,
      agent_id: primary.id,
      agent_name: primary.name,
      stage,
    };

    const collab =
      mentions.others.length > 0
        ? `\n【协同提及】${mentions.others
            .map((o) => `@${o.id}(${o.name})`)
            .join(", ")}`
        : "";
    const feedback = [
      `【工单 Agent 聊天 · 主数字人 ${primary.id} · stage=${stage}】`,
      text,
      collab,
      "请按你的角色处理上述补充需求；不要擅自改流水线编排。",
    ]
      .filter(Boolean)
      .join("\n");

    const configured =
      this.studioConfig.getForTeam(order.team_id || "").bridge_base_url || "";
    const bridgeBase =
      studioReachableBridgeBase(
        order.run.studio?.bridge_base_url || configured,
      ) || "";
    if (!bridgeBase) {
      throw new BadRequestException("未配置 Bridge 地址，无法调用 Agent");
    }

    let agentMsg: AgentChatMessage;
    try {
      const result = await makeBridgeClient(bridgeBase).executeStage(
        bridgeRunId,
        stage,
        { feedback },
      );
      const summary = (result.summary || "").trim() || `(stage ${stage} 完成)`;
      agentMsg = {
        id: randomUUID().slice(0, 8),
        role: "agent",
        content: summary,
        created_at: this.nowIso(),
        agent_id: primary.id,
        agent_name: primary.name,
        stage: result.stage || stage,
      };

      order.run.studio = {
        ...order.run.studio!,
        bridge_run_id: result.runId || bridgeRunId,
        bridge_base_url: order.run.studio?.bridge_base_url || bridgeBase,
        current_stage: result.stage || stage,
        last_summary: summary,
        dry_run: Boolean(order.run.studio?.dry_run),
        pending_human: Boolean(result.pendingHumanApproval),
        status: order.run.studio?.status || "running",
        error: null,
        last_synced_at: this.nowIso(),
      };
      this.appendRunEvent(order, {
        type: "bridge_stage",
        message: `Agent 聊天 · @${primary.id} · ${summary.slice(0, 200)}`,
        agent: primary.id,
        bridge_stage: result.stage || stage,
        bridge_run_id: result.runId || bridgeRunId,
        detail: {
          source: "agent_chat",
          agent_id: primary.id,
          stage: result.stage || stage,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      agentMsg = {
        id: randomUUID().slice(0, 8),
        role: "system",
        content: `调用失败：${msg}`,
        created_at: this.nowIso(),
        agent_id: primary.id,
        agent_name: primary.name,
        stage,
        error: msg,
      };
      this.appendRunEvent(order, {
        type: "sync_error",
        level: "error",
        message: `Agent 聊天失败 · @${primary.id}: ${msg}`,
        agent: primary.id,
        bridge_stage: stage,
        bridge_run_id: bridgeRunId,
        detail: { source: "agent_chat", error: msg },
      });
    }

    const clarifications = [
      ...(order.clarifications || []),
      { at: stamp, note: `[Agent 聊天 @${primary.id}] ${text}` },
    ];
    const requirement = `${order.requirement.trim()}\n\n## Agent 聊天补充（${stamp} · @${primary.id}）\n${text}`;
    const saved = await this.write({
      ...order,
      clarifications,
      requirement,
    });
    const thread = await appendAgentChatMessages(id, [userMsg, agentMsg]);
    return { thread, order: saved };
  }
  async postAgentChatForUser(
    userId: string,
    id: string,
    body: unknown,
  ): Promise<{ thread: AgentChatThread; order: WorkOrder }> {
    await this.requireWritableWorkOrder(userId, id);
    return this.postAgentChat(id, body);
  }

  /** Jump back to a previous/named step and re-run (manager rework). */
  async rework(_id: string, _stepId: string, _feedback = ""): Promise<WorkOrder> {
    throw new BadRequestException(
      "暂不支持 Studio 返工；请结束运行后「重新执行」",
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
      `流水线：${run.pipeline_name} (\`${run.pipeline_id}\`) · run ${run.run_id} · executor=${run.executor || "studio"}`,
    );
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
      configured: this.studioConfig.getEffectiveForTeam(order.team_id || "")
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
        studioConfig: this.studioConfig,
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

    const executor = "studio" as const;
    const cfg = this.studioConfig.getEffectiveForTeam(order.team_id || "");
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

    return this.startStudioFromDraft(order, next, {
      agents_md_path: routing.agents_md_path,
      routing_mode: routing.routing_mode,
      bridge_base_url: studioBridgeBase,
    });
  }

  async startForUser(userId: string, id: string, input: unknown): Promise<WorkOrder> {
    await this.requireWritableWorkOrder(userId, id);
    return this.start(id, input);
  }

  /** Soft-queue a start until a team Bridge becomes idle. */
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
        executor: "studio",
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
          executor: "studio",
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
          executor: "studio",
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
   * Defaults pipeline from the last run — for soft-failed runs, Bridge 503, etc.
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
    const executor = "studio";

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
        onProgress: async (progress) => {
          await this.persistStudioProgress(order.id, order.run!.run_id, progress, bridgeBase);
        },
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
        onProgress: async (progress) => {
          await this.persistStudioProgress(
            current.id,
            current.run!.run_id,
            progress,
            bridgeBase,
          );
        },
      });
      const latest = await this.get(current.id);
      if (latest.run?.run_id !== current.run?.run_id) return;
      await this.applyStudioOutcome(latest, outcome, bridgeBase);
    });
    return saved;
  }

  /** Mid-run progress for live UI (does not flip terminal statuses). */
  private async persistStudioProgress(
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

    return this.write(order);
  }

  async decide(id: string, input: unknown): Promise<WorkOrder> {
    const body = WorkOrderDecisionSchema.parse(input);
    const order = await this.get(id);
    if (!order.run) throw new BadRequestException("工单尚未启动流水线");
    return this.decideStudio(id, body);
  }

  async decideForUser(userId: string, id: string, input: unknown): Promise<WorkOrder> {
    await this.requireWritableWorkOrder(userId, id);
    return this.decide(id, input);
  }

  /** Local stub executor removed — steps run via Studio orchestrator. */
  runCurrentStep(_id: string): WorkOrder {
    throw new BadRequestException(
      "本地执行器已移除；请使用 Studio 编排（「开始流水线」）",
    );
  }

  /** Drop a Bridge soft-queue. */
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

  /** Force-end current run (Studio orchestrator). */
  async rejectAndEnd(id: string, feedback = ""): Promise<WorkOrder> {
    const order = await this.get(id);
    if (order.status === "queued") {
      return this.cancelQueued(id, feedback || "取消 Bridge 排队");
    }
    if (!order.run) throw new BadRequestException("工单尚未启动流水线");
    if (order.status !== "running" && order.status !== "pending_approval") {
      throw new BadRequestException(`当前状态不可驳回结束: ${order.status}`);
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
    if (run.studio) {
      run.studio.status = "rejected";
      run.studio.pending_human = false;
      run.studio.error = feedback || "rejectAndEnd";
      run.studio.last_synced_at = this.nowIso();
    }
    this.appendRunEvent(order, {
      type: "run_finished",
      level: "warn",
      message: `手动结束运行：${feedback || "rejectAndEnd"}`,
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
    const cfg = this.studioConfig.getEffectiveForTeam(saved.team_id || "");
    const registered = await this.bridges.pickRegisteredBaseUrl({
      teamId: saved.team_id,
    });
    return this.startStudioFromDraft(saved, saved, {
      agents_md_path: saved.run?.selected_agents_md_path,
      routing_mode: "explicit",
      bridge_base_url: resolveStudioBridgeBase({
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
