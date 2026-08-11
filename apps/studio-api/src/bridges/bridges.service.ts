import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
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

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9._/:@%+=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class BridgesService implements OnModuleInit {
  private dataDir = "";
  private expectedToken = "";

  constructor(
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
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  private filePath(id: string) {
    return path.join(this.dataDir, `${id}.yaml`);
  }

  private nowIso() {
    return new Date().toISOString();
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

  list(filters?: { status?: string }) {
    const files = fs
      .readdirSync(this.dataDir)
      .filter((f) => f.endsWith(".yaml"));
    let items = files.map((f) =>
      BridgeExecutorSchema.parse(
        YAML.parse(fs.readFileSync(path.join(this.dataDir, f), "utf8")),
      ),
    );
    if (filters?.status && filters.status !== "all") {
      items = items.filter((b) => b.status === filters.status);
    }
    return items.sort((a, b) =>
      (b.last_seen_at || "").localeCompare(a.last_seen_at || ""),
    );
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
    return this.list(filters).filter((b) =>
      this.inScopedTeams(b.team_id, scoped),
    );
  }

  get(id: string): BridgeExecutor {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) throw new NotFoundException(`bridge not found: ${id}`);
    return BridgeExecutorSchema.parse(YAML.parse(fs.readFileSync(fp, "utf8")));
  }

  async getForUser(userId: string, id: string): Promise<BridgeExecutor> {
    const bridge = this.get(id);
    await this.assertReadable(userId, bridge);
    return bridge;
  }

  private write(bridge: BridgeExecutor, broadcast = true): BridgeExecutor {
    const next = BridgeExecutorSchema.parse({
      ...bridge,
      updated_at: this.nowIso(),
      created_at: bridge.created_at || this.nowIso(),
    });
    fs.writeFileSync(
      this.filePath(next.id),
      `# Bridge executor ${next.id}\n${YAML.stringify(next, { lineWidth: 100 })}`,
      "utf8",
    );
    if (broadcast) {
      this.realtime.publishBridge(next);
      this.realtime.publishBridges(this.list());
    }
    return next;
  }

  register(input: unknown): BridgeExecutor {
    const body = BridgeRegisterSchema.parse(input);
    this.assertToken(body.token);
    const id = body.id?.trim() || this.idFromName(body.name, body.base_url);
    const existing = fs.existsSync(this.filePath(id)) ? this.get(id) : null;
    return this.write({
      id,
      // Machine auth: preserve team from prepare/bootstrap; new = "" until stamped.
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
      created_at: existing?.created_at,
      note: existing?.note || "",
    });
  }

  /** Upsert from WebSocket without requiring HTTP body schema token twice. */
  connectFromWs(input: {
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
  }): BridgeExecutor {
    return this.register({
      ...input,
      status: "online",
    });
  }

  setStatus(
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
  ): BridgeExecutor {
    const current = this.get(id);
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

  heartbeat(id: string, input: unknown): BridgeExecutor {
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

  markOffline(id: string): BridgeExecutor | null {
    try {
      return this.setStatus(id, { status: "offline", current_run_id: "" });
    } catch {
      return null;
    }
  }

  remove(id: string) {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) throw new NotFoundException(`bridge not found: ${id}`);
    fs.unlinkSync(fp);
    this.realtime.publishBridges(this.list());
    return { ok: true, id };
  }

  async removeForUser(userId: string, id: string) {
    const current = this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    return this.remove(id);
  }

  /**
   * UI “添加执行器”：预登记一条 offline 记录，并生成可复制的 npx 启动命令。
   * 执行器连上 WS 后会按 name+base_url 更新为 online。
   */
  prepare(input: unknown): {
    bridge: BridgeExecutor;
    install_command: string;
    local_command: string;
    auth_mode: string;
    /** Env var name to prefix when auth_mode=key (client fills value; never stored here) */
    agent_env_key: string;
    token_configured: boolean;
  } {
    const body = BridgePrepareSchema.parse(input);
    const baseUrl = body.base_url.replace(/\/$/, "");
    const studioUrl = body.studio_url.replace(/\/$/, "");
    const id = this.idFromName(body.name, baseUrl);
    const existing = fs.existsSync(this.filePath(id)) ? this.get(id) : null;
    const authMode = body.auth_mode || "none";
    const bridge = this.write({
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
      status: existing?.status === "online" || existing?.status === "busy"
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
    if (authMode === "login" && (body.driver === "cursor" || body.driver === "auto")) {
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
