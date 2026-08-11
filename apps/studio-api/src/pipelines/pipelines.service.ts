import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  PipelineComposeSchema,
  PipelineCreateSchema,
  PipelineDifyBindingPublicSchema,
  PipelinePublicSchema,
  PipelineSchema,
  PipelineUpdateSchema,
  type Pipeline,
  type PipelineCreate,
  type PipelinePublic,
  type PipelineUpdate,
} from "@agent-studio/agent-schema";
import { DigitalHumansService } from "../digital-humans/digital-humans.service";
import { DifyConfigService } from "../dify/dify-config.service";
import { TeamsService } from "../teams/teams.service";
import { bridgeAuthHeaders } from "../bridges/bridge-http";
import { DEFAULT_PIPELINES, composePipelineFromPrompt } from "./defaults";

function resolveBridgeBaseUrl(configured?: string): string {
  return (
    (configured || "").trim().replace(/\/$/, "") || "http://127.0.0.1:8787"
  );
}

@Injectable()
export class PipelinesService implements OnModuleInit {
  private dataDir = path.resolve(
    process.env.STUDIO_PIPELINE_DIR ||
      path.join(process.cwd(), "data", "pipelines"),
  );

  constructor(
    private readonly humans: DigitalHumansService,
    private readonly difyConfig: DifyConfigService,
    private readonly teams: TeamsService,
  ) {}

  onModuleInit() {
    this.dataDir = path.resolve(
      process.env.STUDIO_PIPELINE_DIR ||
        path.join(process.cwd(), "data", "pipelines"),
    );
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  getDataDir() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    return this.dataDir;
  }

  private filePath(id: string) {
    return path.join(this.getDataDir(), `${id}.yaml`);
  }

  private nowIso() {
    return new Date().toISOString();
  }

  private assertAgentsExist(steps: Pipeline["steps"]) {
    const missing = steps
      .map((s) => s.agent)
      .filter((agentId) => {
        try {
          this.humans.get(agentId);
          return false;
        } catch {
          return true;
        }
      });
    const unique = [...new Set(missing)];
    if (unique.length) {
      throw new BadRequestException(`未知数字人: ${unique.join(", ")}`);
    }
  }

  private inScopedTeams(teamId: string | undefined, scoped: string[]) {
    const tid = (teamId || "").trim();
    if (!tid) return false;
    return scoped.includes(tid);
  }

  private async assertReadable(userId: string, pipeline: Pipeline) {
    const tid = (pipeline.team_id || "").trim();
    if (!tid) {
      throw new NotFoundException(`not found: ${pipeline.id}`);
    }
    await this.teams.requireMember(tid, userId);
  }

  list(filters?: { enabled?: "true" | "false" | "all"; q?: string }) {
    const dir = this.getDataDir();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"));
    let items = files.map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      return this.toPublic(PipelineSchema.parse(YAML.parse(raw)));
    });

    const enabled = filters?.enabled ?? "all";
    if (enabled === "true") items = items.filter((p) => p.enabled);
    if (enabled === "false") items = items.filter((p) => !p.enabled);
    if (filters?.q?.trim()) {
      const needle = filters.q.trim().toLowerCase();
      items = items.filter(
        (p) =>
          p.id.includes(needle) ||
          p.name.toLowerCase().includes(needle) ||
          (p.description || "").toLowerCase().includes(needle) ||
          p.tags.some((t) => t.toLowerCase().includes(needle)),
      );
    }
    return items.sort((a, b) => a.id.localeCompare(b.id));
  }

  async listForUser(
    userId: string,
    filters?: {
      enabled?: "true" | "false" | "all";
      q?: string;
      team_id?: string;
    },
  ) {
    const scoped = await this.teams.resolveScopedTeamIds(
      userId,
      filters?.team_id,
    );
    if (!scoped.length) return [];
    return this.list(filters).filter((p) =>
      this.inScopedTeams(p.team_id, scoped),
    );
  }

  get(id: string): Pipeline {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) throw new NotFoundException(`not found: ${id}`);
    return PipelineSchema.parse(YAML.parse(fs.readFileSync(fp, "utf8")));
  }

  getPublic(id: string) {
    return this.toPublic(this.get(id));
  }

  async getPublicForUser(userId: string, id: string) {
    const pipeline = this.get(id);
    await this.assertReadable(userId, pipeline);
    return this.toPublic(pipeline);
  }

  async getForUser(userId: string, id: string): Promise<Pipeline> {
    const pipeline = this.get(id);
    await this.assertReadable(userId, pipeline);
    return pipeline;
  }

  /** Redact api_key for API responses. */
  toPublic(pipeline: Pipeline): PipelinePublic {
    const dify = pipeline.dify || {};
    return PipelinePublicSchema.parse({
      ...pipeline,
      dify: PipelineDifyBindingPublicSchema.parse({
        enabled: Boolean(dify.enabled),
        api_base: dify.api_base || "",
        app_id: dify.app_id || "",
        workflow_id: dify.workflow_id || "",
        note: dify.note || "",
        api_key_set: Boolean(dify.api_key?.trim()),
      }),
    });
  }

  create(input: PipelineCreate): PipelinePublic {
    let body: PipelineCreate;
    try {
      body = PipelineCreateSchema.parse(input);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    if (fs.existsSync(this.filePath(body.id))) {
      throw new ConflictException(`already exists: ${body.id}`);
    }
    this.assertAgentsExist(body.steps);
    return this.toPublic(this.write(body as Pipeline));
  }

  async createForUser(userId: string, input: PipelineCreate): Promise<PipelinePublic> {
    let body: PipelineCreate;
    try {
      body = PipelineCreateSchema.parse(input);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    const teamId = (body.team_id || "").trim();
    if (!teamId) {
      throw new BadRequestException("team_id is required");
    }
    await this.teams.requireWritableMember(teamId, userId);
    return this.create({ ...body, team_id: teamId });
  }

  update(id: string, patch: PipelineUpdate): PipelinePublic {
    const current = this.get(id);
    try {
      const parsed = PipelineUpdateSchema.parse(patch);
      const nextDify = {
        ...(current.dify || {}),
        ...(parsed.dify || {}),
        api_key:
          parsed.dify?.api_key === undefined || parsed.dify?.api_key === ""
            ? current.dify?.api_key || ""
            : parsed.dify.api_key,
      };
      const merged = PipelineSchema.parse({
        ...current,
        ...parsed,
        id,
        team_id: current.team_id,
        source: { ...current.source, ...(parsed.source || {}) },
        defaults: { ...current.defaults, ...(parsed.defaults || {}) },
        steps: parsed.steps || current.steps,
        dify: nextDify,
      });
      this.assertAgentsExist(merged.steps);
      return this.toPublic(this.write(merged));
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  async updateForUser(
    userId: string,
    id: string,
    patch: PipelineUpdate,
  ): Promise<PipelinePublic> {
    const current = this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    return this.update(id, patch);
  }

  setEnabled(id: string, enabled: boolean): PipelinePublic {
    return this.toPublic(this.write({ ...this.get(id), enabled }));
  }

  async setEnabledForUser(
    userId: string,
    id: string,
    enabled: boolean,
  ): Promise<PipelinePublic> {
    const current = this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    return this.setEnabled(id, enabled);
  }

  remove(id: string) {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) throw new NotFoundException(`not found: ${id}`);
    fs.unlinkSync(fp);
    return { ok: true as const, id };
  }

  async removeForUser(userId: string, id: string) {
    const current = this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    return this.remove(id);
  }

  seedDefaults(teamId = "") {
    const imported: string[] = [];
    const skipped: string[] = [];
    for (const item of DEFAULT_PIPELINES) {
      if (fs.existsSync(this.filePath(item.id))) {
        skipped.push(item.id);
        continue;
      }
      try {
        this.assertAgentsExist(item.steps);
        this.write(PipelineSchema.parse({ ...item, team_id: teamId || "" }));
        imported.push(item.id);
      } catch (err) {
        throw new BadRequestException(
          `seed failed for ${item.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { imported, skipped, total: this.list().length, dataDir: this.getDataDir() };
  }

  async seedDefaultsForUser(userId: string, teamId: string) {
    const tid = (teamId || "").trim();
    if (!tid) throw new BadRequestException("team_id is required");
    await this.teams.requireWritableMember(tid, userId);
    return this.seedDefaults(tid);
  }

  async compose(input: unknown) {
    const body = PipelineComposeSchema.parse(input);
    // Shared hard rule before agent or rules.
    const lower = body.prompt.toLowerCase();
    if (/生产|production|prod/.test(lower) && /发布|部署|上线/.test(body.prompt)) {
      throw new BadRequestException(
        "不允许通过自然语言开启生产发布，请仅使用 staging 运维步骤",
      );
    }

    let draft: PipelineCreate;
    let generatedBy: "agent" | "rules" = "rules";
    let agentMeta: {
      driver?: string;
      dry_run?: boolean;
      fallback_reason?: string;
    } = {};

    const agentDraft = await this.tryComposeViaBridge(body.prompt);
    if (agentDraft.ok) {
      draft = agentDraft.draft;
      generatedBy = "agent";
      agentMeta = {
        driver: agentDraft.driver,
        dry_run: agentDraft.dryRun,
      };
    } else {
      try {
        draft = composePipelineFromPrompt(body.prompt);
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : String(err),
        );
      }
      agentMeta = { fallback_reason: agentDraft.reason };
    }

    if (body.id) draft.id = body.id;
    if (body.name) draft.name = body.name;
    if (body.team_id) draft.team_id = body.team_id;
    // Ensure NL provenance
    draft.source = {
      kind: "nl",
      nl_prompt: body.prompt,
      template_id:
        draft.source?.template_id ||
        (generatedBy === "agent" ? "agent" : draft.source?.template_id),
    };
    this.assertAgentsExist(draft.steps);
    if (body.save) {
      if (fs.existsSync(this.filePath(draft.id))) {
        throw new ConflictException(`already exists: ${draft.id}`);
      }
      return {
        draft: this.toPublic(this.write(PipelineSchema.parse(draft))),
        saved: true,
        generated_by: generatedBy,
        ...agentMeta,
      };
    }
    return {
      draft: PipelineCreateSchema.parse(draft),
      saved: false,
      generated_by: generatedBy,
      ...agentMeta,
    };
  }

  async composeForUser(userId: string, input: unknown) {
    const body = PipelineComposeSchema.parse(input);
    if (body.save) {
      const teamId = (body.team_id || "").trim();
      if (!teamId) {
        throw new BadRequestException("team_id is required when save=true");
      }
      await this.teams.requireWritableMember(teamId, userId);
      return this.compose({ ...body, team_id: teamId });
    }
    // Draft-only: still scope team_id if provided (membership check optional for preview)
    if (body.team_id?.trim()) {
      await this.teams.assertTeamAccess(body.team_id.trim(), userId);
    }
    return this.compose(body);
  }

  private async tryComposeViaBridge(prompt: string): Promise<
    | {
        ok: true;
        draft: PipelineCreate;
        driver?: string;
        dryRun?: boolean;
      }
    | { ok: false; reason: string }
  > {
    const agents = this.humans
      .list({ enabled: "true" })
      .map((h) => ({
        id: h.id,
        name: h.name,
        role: h.role,
        description: h.description || "",
      }));
    if (!agents.length) {
      return { ok: false, reason: "no enabled digital humans" };
    }

    const bridgeBase = resolveBridgeBaseUrl(
      this.difyConfig.get().bridge_base_url,
    );
    const url = `${bridgeBase}/compose/pipeline`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: bridgeAuthHeaders(),
        body: JSON.stringify({ prompt, agents }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          reason: `bridge HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      const data = (await res.json()) as {
        draft?: unknown;
        driver?: string;
        dryRun?: boolean;
      };
      if (!data?.draft) {
        return { ok: false, reason: "bridge returned empty draft" };
      }
      let draft: PipelineCreate;
      try {
        draft = PipelineCreateSchema.parse(data.draft);
        this.assertAgentsExist(draft.steps);
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
      return {
        ok: true,
        draft,
        driver: data.driver,
        dryRun: data.dryRun,
      };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private write(pipeline: Pipeline): Pipeline {
    const stamp = this.nowIso();
    const existing = fs.existsSync(this.filePath(pipeline.id))
      ? this.get(pipeline.id)
      : null;
    const next = PipelineSchema.parse({
      ...pipeline,
      created_at: pipeline.created_at || existing?.created_at || stamp,
      updated_at: stamp,
    });
    fs.writeFileSync(
      this.filePath(next.id),
      `# Agent Studio pipeline\n${YAML.stringify(next, { lineWidth: 100 })}`,
      "utf8",
    );
    return next;
  }
}
