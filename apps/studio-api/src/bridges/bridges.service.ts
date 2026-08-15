import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash } from "node:crypto";
import { Repository } from "typeorm";
import {
  BridgeExecutorSchema,
  BridgeHeartbeatSchema,
  BridgePrepareSchema,
  BridgeRegisterSchema,
  type BridgeExecutor,
  type BridgeStatus,
} from "@agent-studio/agent-schema";
import { RealtimeHub } from "../realtime/realtime.hub";
import { TeamsService } from "../teams/teams.service";
import { BridgeEntity } from "./entities/bridge.entity";

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9._/:@%+=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class BridgesService implements OnModuleInit {
  private expectedToken = "";

  constructor(
    @InjectRepository(BridgeEntity)
    private readonly repo: Repository<BridgeEntity>,
    private readonly realtime: RealtimeHub,
    private readonly teams: TeamsService,
  ) {}

  onModuleInit() {
    this.expectedToken = (
      process.env.STUDIO_BRIDGE_TOKEN ||
      process.env.BRIDGE_TOKEN ||
      ""
    ).trim();
  }

  private nowIso() {
    return new Date().toISOString();
  }

  private toBridge(entity: BridgeEntity): BridgeExecutor {
    return BridgeExecutorSchema.parse({
      id: entity.id,
      team_id: entity.team_id || "",
      name: entity.name,
      base_url: entity.base_url,
      driver: entity.driver || "auto",
      driver_label: entity.driver_label || "",
      dry_run: Boolean(entity.dry_run),
      model: entity.model || "",
      platform: entity.platform || "",
      link_type: entity.link_type === "desktop" ? "desktop" : "cli",
      available_drivers: entity.available_drivers || [],
      status: entity.status || "offline",
      current_run_id: entity.current_run_id || "",
      last_seen_at: entity.last_seen_at || undefined,
      note: entity.note || "",
      created_at: entity.created_at?.toISOString?.() || undefined,
      updated_at: entity.updated_at?.toISOString?.() || undefined,
    });
  }

  private toEntityFields(bridge: BridgeExecutor): Partial<BridgeEntity> {
    return {
      id: bridge.id,
      team_id: (bridge.team_id || "").trim(),
      name: bridge.name,
      base_url: bridge.base_url.replace(/\/$/, ""),
      driver: bridge.driver || "auto",
      driver_label: bridge.driver_label || "",
      dry_run: Boolean(bridge.dry_run),
      model: bridge.model || "",
      platform: bridge.platform || "",
      link_type: bridge.link_type === "desktop" ? "desktop" : "cli",
      available_drivers: bridge.available_drivers || [],
      status: bridge.status || "offline",
      current_run_id: bridge.current_run_id || "",
      last_seen_at: bridge.last_seen_at || "",
      note: bridge.note || "",
      created_at: bridge.created_at ? new Date(bridge.created_at) : undefined,
      updated_at: bridge.updated_at ? new Date(bridge.updated_at) : undefined,
    };
  }

  private inScopedTeams(teamId: string | undefined, scoped: string[]) {
    const tid = (teamId || "").trim();
    if (!tid) return false;
    return scoped.includes(tid);
  }

  private async assertReadable(userId: string, bridge: BridgeExecutor) {
    const tid = (bridge.team_id || "").trim();
    if (!tid) {
      throw new NotFoundException(`bridge not found: ${bridge.id}`);
    }
    await this.teams.requireMember(tid, userId);
  }

  assertToken(token: string) {
    if (!this.expectedToken) {
      throw new BadRequestException(
        "Studio 未配置 STUDIO_BRIDGE_TOKEN，无法注册执行器",
      );
    }
    if (token !== this.expectedToken) {
      throw new UnauthorizedException("invalid bridge token");
    }
  }

  private idFromName(name: string, baseUrl: string) {
    const digest = createHash("sha1")
      .update(`${name}|${baseUrl}`)
      .digest("hex")
      .slice(0, 10);
    return `br-${digest}`;
  }

  async list(filters?: { status?: string }) {
    let items = (await this.repo.find()).map((e) => this.toBridge(e));
    if (filters?.status && filters.status !== "all") {
      items = items.filter((b) => b.status === filters.status);
    }
    return items.sort((a, b) =>
      (b.last_seen_at || "").localeCompare(a.last_seen_at || ""),
    );
  }

  private idleListeners: Array<(bridge: BridgeExecutor) => void> = [];

  /** Work-order queue admission hooks when an executor leaves busy → online. */
  onExecutorIdle(listener: (bridge: BridgeExecutor) => void) {
    this.idleListeners.push(listener);
  }

  private notifyExecutorIdle(previous: BridgeExecutor, next: BridgeExecutor) {
    if (previous.status !== "busy" || next.status !== "online") return;
    for (const listener of this.idleListeners) {
      try {
        listener(next);
      } catch (err) {
        // Keep status sync resilient; admission failures are logged by callers.
        console.warn(
          `[bridges] idle listener failed for ${next.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  /**
   * Prefer a registered executor's public base_url for Studio→Bridge HTTP.
   * Optional teamId scopes to that team; otherwise any reachable executor.
   */
  async pickRegisteredBaseUrl(opts?: {
    teamId?: string;
    /** When true, only idle `online` executors (for admitting new runs). */
    preferIdle?: boolean;
  }): Promise<string | undefined> {
    const preferred = await this.pickRegisteredExecutor(opts);
    return preferred?.base_url?.replace(/\/$/, "") || undefined;
  }

  /**
   * Pick a registered executor.
   * - Team scope is strict: never another team's Bridge (unscoped/empty team_id allowed as shared).
   * - Prefers `online` over `busy` unless only busy remain (and preferIdle is false).
   */
  async pickRegisteredExecutor(opts?: {
    teamId?: string;
    preferIdle?: boolean;
  }): Promise<BridgeExecutor | undefined> {
    const teamId = (opts?.teamId || "").trim();
    let candidates = (await this.list()).filter((b) => {
      if (b.status !== "online" && b.status !== "busy") return false;
      if (!b.base_url?.trim()) return false;
      return true;
    });

    if (teamId) {
      const exact = candidates.filter(
        (b) => (b.team_id || "").trim() === teamId,
      );
      const unscoped = candidates.filter((b) => !(b.team_id || "").trim());
      candidates = exact.length ? exact : unscoped;
    }

    if (opts?.preferIdle) {
      candidates = candidates.filter((b) => b.status === "online");
    } else {
      const idle = candidates.filter((b) => b.status === "online");
      if (idle.length) candidates = idle;
    }

    // list() is sorted by last_seen_at desc — keep that order for soft RR among peers.
    return candidates[0];
  }

  /**
   * Resolve Bridge URL for a new work-order start.
   * Prefer idle registered executors; report busy_pool when the team only has busy hosts.
   * When preferredBridgeId is set, pin to that executor (queue if busy).
   */
  async resolveForNewRun(opts?: {
    teamId?: string;
    override?: string;
    configured?: string;
    preferredBridgeId?: string;
  }): Promise<
    | {
        ok: true;
        studioBaseUrl: string;
        registeredBaseUrl?: string;
        bridge?: BridgeExecutor;
      }
    | { ok: false; reason: "busy_pool" | "unreachable"; message: string }
  > {
    const override = (opts?.override || "").trim().replace(/\/$/, "");
    if (override) {
      const matched = await this.findByBaseUrl(override, opts?.teamId);
      return {
        ok: true,
        studioBaseUrl: override,
        registeredBaseUrl: matched?.base_url?.replace(/\/$/, "") || undefined,
        bridge: matched,
      };
    }

    const preferredId = (opts?.preferredBridgeId || "").trim();
    if (preferredId) {
      let bridge: BridgeExecutor;
      try {
        bridge = await this.get(preferredId);
      } catch {
        return {
          ok: false,
          reason: "unreachable",
          message: `指定的执行器不存在：${preferredId}`,
        };
      }
      const teamId = (opts?.teamId || "").trim();
      const bridgeTeam = (bridge.team_id || "").trim();
      if (teamId && bridgeTeam && bridgeTeam !== teamId) {
        return {
          ok: false,
          reason: "unreachable",
          message: `指定的执行器不属于当前团队：${bridge.name || preferredId}`,
        };
      }
      const base = (bridge.base_url || "").trim().replace(/\/$/, "");
      if (!base) {
        return {
          ok: false,
          reason: "unreachable",
          message: `指定的执行器未配置 base_url：${bridge.name || preferredId}`,
        };
      }
      if (bridge.status === "online") {
        return {
          ok: true,
          studioBaseUrl: base,
          registeredBaseUrl: base,
          bridge,
        };
      }
      if (bridge.status === "busy") {
        return {
          ok: false,
          reason: "busy_pool",
          message: `执行器「${bridge.name || preferredId}」正在执行中，工单将排队等待其空闲`,
        };
      }
      return {
        ok: false,
        reason: "unreachable",
        message: `指定的执行器不可用（状态 ${bridge.status}）：${bridge.name || preferredId}`,
      };
    }

    const idle = await this.pickRegisteredExecutor({
      teamId: opts?.teamId,
      preferIdle: true,
    });
    if (idle?.base_url?.trim()) {
      const idleUrl = idle.base_url.replace(/\/$/, "");
      return {
        ok: true,
        studioBaseUrl: idleUrl,
        registeredBaseUrl: idleUrl,
        bridge: idle,
      };
    }

    const busy = await this.pickRegisteredExecutor({
      teamId: opts?.teamId,
      preferIdle: false,
    });
    if (busy?.status === "busy") {
      return {
        ok: false,
        reason: "busy_pool",
        message:
          "团队 Bridge 均在执行中，工单将排队等待空闲执行器（也可稍后点「重新执行」）",
      };
    }

    const configured = (opts?.configured || "").trim().replace(/\/$/, "");
    if (!configured) {
      return {
        ok: false,
        reason: "unreachable",
        message:
          "无可用 Bridge：请启动执行器并完成 WS 注册，或在团队设置填写 bridge_base_url",
      };
    }

    const health = await this.probeBridgeHealthDetail(configured);
    if (!health.ok) {
      return {
        ok: false,
        reason: "unreachable",
        message: `Bridge 不可达（${configured}/health）。请启动 Bridge 或确认已注册在线执行器`,
      };
    }
    if (health.status === "busy") {
      return {
        ok: false,
        reason: "busy_pool",
        message:
          "配置的 Bridge 正忙，工单将排队等待空闲（也可稍后点「重新执行」）",
      };
    }
    const matched = await this.findByBaseUrl(configured, opts?.teamId);
    return {
      ok: true,
      studioBaseUrl: configured,
      bridge: matched,
    };
  }

  /** Match a registered executor by normalized base_url (optional team scope). */
  async findByBaseUrl(
    baseUrl: string,
    teamId?: string,
  ): Promise<BridgeExecutor | undefined> {
    const target = (baseUrl || "").trim().replace(/\/$/, "");
    if (!target) return undefined;
    const tid = (teamId || "").trim();
    const all = await this.list();
    const matches = all.filter(
      (b) => (b.base_url || "").trim().replace(/\/$/, "") === target,
    );
    if (!matches.length) return undefined;
    if (tid) {
      const exact = matches.find((b) => (b.team_id || "").trim() === tid);
      if (exact) return exact;
      const unscoped = matches.find((b) => !(b.team_id || "").trim());
      if (unscoped) return unscoped;
    }
    return matches[0];
  }

  /**
   * Fail fast before workspace ensure / Studio start when Bridge looks unreachable.
   * Mid-run helpers may pass preferIdle=false so busy hosts still count as reachable.
   */
  async requireReachableBaseUrl(opts?: {
    teamId?: string;
    override?: string;
    configured?: string;
    preferIdle?: boolean;
  }): Promise<{ studioBaseUrl: string; registeredBaseUrl?: string }> {
    if (opts?.preferIdle) {
      const resolved = await this.resolveForNewRun(opts);
      if (!resolved.ok) {
        throw new BadRequestException(resolved.message);
      }
      return {
        studioBaseUrl: resolved.studioBaseUrl,
        registeredBaseUrl: resolved.registeredBaseUrl,
      };
    }

    const override = (opts?.override || "").trim().replace(/\/$/, "");
    const registered = await this.pickRegisteredBaseUrl({
      teamId: opts?.teamId,
    });
    const configured = (opts?.configured || "").trim().replace(/\/$/, "");
    const studioBaseUrl = override || registered || configured;
    if (!studioBaseUrl) {
      throw new BadRequestException(
        "无可用 Bridge：请启动执行器并完成 WS 注册，或在团队设置填写 bridge_base_url",
      );
    }
    if (!override && !registered && configured) {
      // Settings-only fallback — probe health so we fail before Studio starts.
      const ok = await this.probeBridgeHealth(studioBaseUrl);
      if (!ok) {
        throw new BadRequestException(
          `Bridge 不可达（${studioBaseUrl}/health）。请启动 Bridge 或确认已注册在线执行器`,
        );
      }
    }
    return {
      studioBaseUrl,
      registeredBaseUrl: registered,
    };
  }

  async probeBridgeHealth(baseUrl: string): Promise<boolean> {
    const detail = await this.probeBridgeHealthDetail(baseUrl);
    return detail.ok;
  }

  async probeBridgeHealthDetail(
    baseUrl: string,
  ): Promise<{ ok: boolean; status?: string }> {
    const base = baseUrl.replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return { ok: false };
      const body = (await res.json().catch(() => null)) as {
        status?: string;
      } | null;
      return {
        ok: true,
        status: typeof body?.status === "string" ? body.status : undefined,
      };
    } catch {
      return { ok: false };
    }
  }

  async listForUser(
    userId: string,
    filters?: { status?: string; team_id?: string },
  ) {
    const scoped = await this.teams.resolveScopedTeamIds(
      userId,
      filters?.team_id,
    );
    if (!scoped.length) return [];
    return (await this.list(filters)).filter((b) =>
      this.inScopedTeams(b.team_id, scoped),
    );
  }

  async get(id: string): Promise<BridgeExecutor> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`bridge not found: ${id}`);
    return this.toBridge(entity);
  }

  async getForUser(userId: string, id: string): Promise<BridgeExecutor> {
    const bridge = await this.get(id);
    await this.assertReadable(userId, bridge);
    return bridge;
  }

  private async write(
    bridge: BridgeExecutor,
    broadcast = true,
  ): Promise<BridgeExecutor> {
    const stamp = this.nowIso();
    const existing = await this.repo.findOne({ where: { id: bridge.id } });
    const previous = existing ? this.toBridge(existing) : null;
    const next = BridgeExecutorSchema.parse({
      ...bridge,
      updated_at: stamp,
      created_at:
        bridge.created_at ||
        existing?.created_at?.toISOString?.() ||
        stamp,
    });
    const fields = this.toEntityFields(next);
    if (existing) {
      Object.assign(existing, fields, {
        created_at: existing.created_at,
        updated_at: new Date(stamp),
      });
      await this.repo.save(existing);
    } else {
      await this.repo.save(this.repo.create(fields));
    }
    const saved = await this.get(next.id);
    if (broadcast) {
      this.realtime.publishBridge(saved);
      this.realtime.publishBridges(await this.list());
    }
    if (previous) this.notifyExecutorIdle(previous, saved);
    return saved;
  }

  async register(input: unknown): Promise<BridgeExecutor> {
    const body = BridgeRegisterSchema.parse(input);
    this.assertToken(body.token);
    const id = body.id?.trim() || this.idFromName(body.name, body.base_url);
    const existing = await this.repo.findOne({ where: { id } });
    const incomingRun = (body.current_run_id || "").trim();
    const preservedRun =
      incomingRun ||
      (existing?.status === "busy" || existing?.status === "online"
        ? (existing?.current_run_id || "").trim()
        : "");
    const status =
      body.status ||
      (preservedRun ? "busy" : "online");
    return this.write({
      id,
      team_id: existing?.team_id || "",
      name: body.name,
      base_url: body.base_url.replace(/\/$/, ""),
      driver: body.driver || "auto",
      driver_label: body.driver_label || "",
      dry_run: Boolean(body.dry_run),
      model: body.model || "",
      platform: body.platform || "",
      link_type: body.link_type === "desktop" ? "desktop" : "cli",
      available_drivers: body.available_drivers || [],
      status,
      current_run_id: preservedRun,
      last_seen_at: this.nowIso(),
      created_at: existing?.created_at?.toISOString?.(),
      note: existing?.note || "",
    });
  }

  /** Upsert from WebSocket without requiring HTTP body schema token twice. */
  async connectFromWs(input: {
    token: string;
    name: string;
    base_url: string;
    driver?: string;
    driver_label?: string;
    dry_run?: boolean;
    model?: string;
    platform?: string;
    link_type?: "cli" | "desktop";
    available_drivers?: string[];
    id?: string;
    status?: BridgeStatus;
    current_run_id?: string;
  }): Promise<BridgeExecutor> {
    return this.register({
      ...input,
      status: input.status || (input.current_run_id ? "busy" : "online"),
      current_run_id: input.current_run_id || "",
    });
  }

  async setStatus(
    id: string,
    patch: {
      status: BridgeStatus;
      current_run_id?: string;
      base_url?: string;
      driver?: string;
      driver_label?: string;
      dry_run?: boolean;
      model?: string;
      link_type?: "cli" | "desktop";
    },
  ): Promise<BridgeExecutor> {
    const current = await this.get(id);
    return this.write({
      ...current,
      ...patch,
      team_id: current.team_id,
      link_type: patch.link_type || current.link_type || "cli",
      base_url: (patch.base_url || current.base_url).replace(/\/$/, ""),
      current_run_id:
        patch.current_run_id !== undefined
          ? patch.current_run_id
          : patch.status === "busy"
            ? current.current_run_id
            : "",
      last_seen_at: this.nowIso(),
    });
  }

  async heartbeat(id: string, input: unknown): Promise<BridgeExecutor> {
    const body = BridgeHeartbeatSchema.parse(input);
    this.assertToken(body.token);
    return this.setStatus(id, {
      status: body.status || "online",
      current_run_id: body.current_run_id,
      base_url: body.base_url,
      driver: body.driver,
      driver_label: body.driver_label,
      dry_run: body.dry_run,
      model: body.model,
      link_type: body.link_type,
    });
  }

  async markOffline(id: string): Promise<BridgeExecutor | null> {
    try {
      return await this.setStatus(id, { status: "offline", current_run_id: "" });
    } catch {
      return null;
    }
  }

  async remove(id: string) {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`bridge not found: ${id}`);
    await this.repo.remove(entity);
    this.realtime.publishBridges(await this.list());
    return { ok: true, id };
  }

  async removeForUser(userId: string, id: string) {
    const current = await this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    return this.remove(id);
  }

  /**
   * UI “添加执行器”：预登记一条 offline 记录，并生成可复制的 npx 启动命令。
   * 执行器连上 WS 后会按 name+base_url 更新为 online。
   */
  async prepare(input: unknown): Promise<{
    bridge: BridgeExecutor;
    install_command: string;
    local_command: string;
    auth_mode: string;
    link_type: "cli" | "desktop";
    agent_env_key: string;
    token_configured: boolean;
  }> {
    const body = BridgePrepareSchema.parse(input);
    const baseUrl = body.base_url.replace(/\/$/, "");
    const studioUrl = body.studio_url.replace(/\/$/, "");
    const id = this.idFromName(body.name, baseUrl);
    const existingEntity = await this.repo.findOne({ where: { id } });
    const existing = existingEntity
      ? this.toBridge(existingEntity)
      : null;
    const authMode = body.auth_mode || "none";
    const linkType = body.link_type === "desktop" ? "desktop" : "cli";
    const bridge = await this.write({
      id,
      team_id: body.team_id,
      name: body.name,
      base_url: baseUrl,
      driver: body.driver,
      driver_label: "",
      dry_run: false,
      model: existing?.model || "",
      platform: existing?.platform || "",
      link_type: linkType,
      available_drivers: existing?.available_drivers || [],
      status:
        existing?.status === "online" || existing?.status === "busy"
          ? existing.status
          : "offline",
      current_run_id: existing?.current_run_id || "",
      last_seen_at: existing?.last_seen_at,
      created_at: existing?.created_at,
      note:
        body.note ||
        existing?.note ||
        `prepared from Studio UI (auth=${authMode}, link=${linkType})`,
    });

    const token = this.expectedToken || "<STUDIO_BRIDGE_TOKEN>";
    const argParts = [
      "start",
      "--driver",
      shellQuote(body.driver),
      "--name",
      shellQuote(body.name),
      "--studio-url",
      shellQuote(studioUrl),
      "--token",
      shellQuote(token),
      "--public-url",
      shellQuote(baseUrl),
    ];
    if (
      authMode === "login" &&
      (body.driver === "cursor" || body.driver === "auto")
    ) {
      argParts.push("--login");
    }
    const args = argParts.join(" ");

    const agentEnvKey =
      body.driver === "cursor" || body.driver === "auto"
        ? "CURSOR_API_KEY"
        : body.driver === "trae"
          ? "TRAECLI_PERSONAL_ACCESS_TOKEN"
          : body.driver === "qoder"
            ? "QODER_PERSONAL_ACCESS_TOKEN"
            : body.driver === "openai"
              ? "OPENAI_API_KEY"
              : "";

    return {
      bridge,
      install_command: `npx @agent-studio/bridge ${args}`,
      local_command: `npm run bridge -- ${args}`,
      auth_mode: authMode,
      link_type: linkType,
      agent_env_key: agentEnvKey,
      token_configured: this.tokenConfigured(),
    };
  }

  async prepareForUser(userId: string, input: unknown) {
    const body = BridgePrepareSchema.parse(input);
    await this.teams.requireWritableMember(body.team_id, userId);
    return this.prepare(body);
  }

  tokenConfigured() {
    return Boolean(this.expectedToken);
  }
}
