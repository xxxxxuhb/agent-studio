import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash } from "node:crypto";
import path from "node:path";
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
  /** Legacy YAML dir (bootstrap import only). */
  private dataDir = "";
  private expectedToken = "";

  constructor(
    @InjectRepository(BridgeEntity)
    private readonly repo: Repository<BridgeEntity>,
    private readonly realtime: RealtimeHub,
    private readonly teams: TeamsService,
  ) {}

  onModuleInit() {
    this.dataDir = path.resolve(
      process.env.STUDIO_BRIDGE_DIR ||
        path.join(process.cwd(), "data", "bridges"),
    );
    this.expectedToken = (
      process.env.STUDIO_BRIDGE_TOKEN ||
      process.env.BRIDGE_TOKEN ||
      ""
    ).trim();
  }

  getDataDir() {
    return this.dataDir;
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

  /**
   * Prefer an online/busy registered executor's public base_url for Studio→Bridge HTTP.
   * Optional teamId scopes to that team; otherwise any reachable executor.
   */
  async pickRegisteredBaseUrl(opts?: {
    teamId?: string;
  }): Promise<string | undefined> {
    const teamId = (opts?.teamId || "").trim();
    const candidates = (await this.list()).filter((b) => {
      if (b.status !== "online" && b.status !== "busy") return false;
      if (!b.base_url?.trim()) return false;
      if (teamId && (b.team_id || "").trim() && b.team_id !== teamId) {
        return false;
      }
      return true;
    });
    const preferred = teamId
      ? candidates.find((b) => (b.team_id || "").trim() === teamId) ||
        candidates[0]
      : candidates[0];
    return preferred?.base_url?.replace(/\/$/, "") || undefined;
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
    return saved;
  }

  async register(input: unknown): Promise<BridgeExecutor> {
    const body = BridgeRegisterSchema.parse(input);
    this.assertToken(body.token);
    const id = body.id?.trim() || this.idFromName(body.name, body.base_url);
    const existing = await this.repo.findOne({ where: { id } });
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
      available_drivers: body.available_drivers || [],
      status: body.status || "online",
      current_run_id: "",
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
    available_drivers?: string[];
    id?: string;
  }): Promise<BridgeExecutor> {
    return this.register({
      ...input,
      status: "online",
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
    },
  ): Promise<BridgeExecutor> {
    const current = await this.get(id);
    return this.write({
      ...current,
      ...patch,
      team_id: current.team_id,
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
        `prepared from Studio UI (auth=${authMode})`,
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
