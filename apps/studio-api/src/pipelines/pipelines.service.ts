import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  PipelineComposeSchema,
  PipelineCreateSchema,
  PipelinePublicSchema,
  PipelineSchema,
  PipelineUpdateSchema,
  normalizePipelineGraph,
  synthesizePipelineEdges,
  syncBranchesFromEdges,
  validatePipelineGraph,
  type Pipeline,
  type PipelineCreate,
  type PipelinePublic,
  type PipelineUpdate,
} from "@agent-studio/agent-schema";
import { DigitalHumansService } from "../digital-humans/digital-humans.service";
import { StudioConfigService } from "../studio-config/studio-config.service";
import { TeamsService } from "../teams/teams.service";
import { AuthService } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { bridgeAuthHeaders } from "../bridges/bridge-http";
import { DEFAULT_PIPELINES, composePipelineFromPrompt } from "./defaults";
import { PipelineEntity } from "./entities/pipeline.entity";

function resolveBridgeBaseUrl(configured?: string): string {
  return (
    (configured || "").trim().replace(/\/$/, "") || "http://127.0.0.1:8787"
  );
}

@Injectable()
export class PipelinesService {
  constructor(
    @InjectRepository(PipelineEntity)
    private readonly repo: Repository<PipelineEntity>,
    private readonly humans: DigitalHumansService,
    private readonly studioConfig: StudioConfigService,
    private readonly teams: TeamsService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  private nowIso() {
    return new Date().toISOString();
  }

  private async actorLabel(userId: string): Promise<string> {
    const u = await this.auth.findById(userId);
    return (u?.display_name || u?.username || userId || "").trim();
  }

  private scheduleAudit(input: Parameters<AuditService["record"]>[0]) {
    void this.audit.record(input).catch(() => undefined);
  }

  private toPipeline(entity: PipelineEntity): Pipeline {
    const defaultsRaw = (entity.defaults || {}) as Record<string, unknown>;
    const {
      entry: storedEntry,
      edges: storedEdges,
      triggers: storedTriggers,
      ...restDefaults
    } = defaultsRaw;
    const graph = normalizePipelineGraph({
      steps: (entity.steps || []) as Pipeline["steps"],
      entry: typeof storedEntry === "string" ? storedEntry : "",
      edges: Array.isArray(storedEdges)
        ? (storedEdges as Pipeline["edges"])
        : [],
    });
    const onReject =
      restDefaults.on_reject === "retry_step" ||
      restDefaults.on_reject === "goto" ||
      restDefaults.on_reject === "end"
        ? restDefaults.on_reject
        : "end";
    return PipelineSchema.parse({
      id: entity.id,
      team_id: entity.team_id || "",
      name: entity.name,
      description: entity.description || "",
      enabled: entity.enabled !== false,
      tags: entity.tags || [],
      source: entity.source || { kind: "handwritten" },
      defaults: {
        human_approval:
          typeof restDefaults.human_approval === "boolean"
            ? restDefaults.human_approval
            : true,
        on_reject: onReject,
      },
      steps: syncBranchesFromEdges(
        (entity.steps || []) as Pipeline["steps"],
        graph.edges,
      ),
      entry: graph.entry,
      edges: graph.edges,
      triggers: Array.isArray(storedTriggers) ? storedTriggers : [],
      created_at: entity.created_at?.toISOString?.() || undefined,
      updated_at: entity.updated_at?.toISOString?.() || undefined,
    });
  }

  private toEntityFields(pipeline: Pipeline): Partial<PipelineEntity> {
    // Steps (incl. branches / on_reject) are the authoring source of truth.
    const entry =
      (pipeline.entry || "").trim() || pipeline.steps[0]?.id || "";
    const edges = synthesizePipelineEdges({
      steps: pipeline.steps,
      entry,
    });
    return {
      id: pipeline.id,
      team_id: (pipeline.team_id || "").trim(),
      name: pipeline.name,
      description: pipeline.description || "",
      enabled: pipeline.enabled !== false,
      tags: pipeline.tags || [],
      source: (pipeline.source || { kind: "handwritten" }) as Record<
        string,
        unknown
      >,
      defaults: {
        ...(pipeline.defaults || {
          human_approval: true,
          on_reject: "end",
        }),
        entry,
        edges,
        triggers: pipeline.triggers || [],
      } as Record<string, unknown>,
      steps: pipeline.steps || [],
      created_at: pipeline.created_at
        ? new Date(pipeline.created_at)
        : undefined,
      updated_at: pipeline.updated_at
        ? new Date(pipeline.updated_at)
        : undefined,
    };
  }

  private async assertAgentsExist(steps: Pipeline["steps"]) {
    const missing: string[] = [];
    for (const s of steps) {
      if ((s.kind || "agent") !== "agent") continue;
      const agentId = (s.agent || "").trim();
      if (!agentId) {
        missing.push("(empty agent)");
        continue;
      }
      try {
        await this.humans.get(agentId);
      } catch {
        missing.push(agentId);
      }
    }
    const unique = [...new Set(missing)];
    if (unique.length) {
      throw new BadRequestException(`未知数字人: ${unique.join(", ")}`);
    }
  }

  private assertGraphValid(pipeline: {
    steps: Pipeline["steps"];
    entry?: string;
    edges?: Pipeline["edges"];
  }) {
    const errors = validatePipelineGraph({
      steps: pipeline.steps,
      entry: pipeline.entry,
      edges: pipeline.edges,
    });
    if (errors.length) {
      throw new BadRequestException(errors.join("; "));
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

  async list(filters?: { enabled?: "true" | "false" | "all"; q?: string }) {
    let items = (await this.repo.find()).map((e) =>
      this.toPublic(this.toPipeline(e)),
    );

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

  /** Internal: enabled pipelines that declare at least one enabled trigger. */
  async listWithTriggers(): Promise<Pipeline[]> {
    return (await this.repo.find())
      .map((e) => this.toPipeline(e))
      .filter((p) => p.enabled && (p.triggers || []).some((t) => t.enabled));
  }

  async patchTriggerLastFired(
    pipelineId: string,
    triggerId: string,
    firedAt: string,
  ): Promise<void> {
    const pipeline = await this.get(pipelineId);
    const triggers = (pipeline.triggers || []).map((t) =>
      t.kind === "cron" && t.id === triggerId
        ? { ...t, last_fired_at: firedAt }
        : t,
    );
    await this.write({ ...pipeline, triggers });
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
    return (await this.list(filters)).filter((p) =>
      this.inScopedTeams(p.team_id, scoped),
    );
  }

  async get(id: string): Promise<Pipeline> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`not found: ${id}`);
    return this.toPipeline(entity);
  }

  async getPublic(id: string) {
    return this.toPublic(await this.get(id));
  }

  async getPublicForUser(userId: string, id: string) {
    const pipeline = await this.get(id);
    await this.assertReadable(userId, pipeline);
    return this.toPublic(pipeline);
  }

  async getForUser(userId: string, id: string): Promise<Pipeline> {
    const pipeline = await this.get(id);
    await this.assertReadable(userId, pipeline);
    return pipeline;
  }

  /** Public API shape (PipelinePublicSchema === PipelineSchema). */
  toPublic(pipeline: Pipeline): PipelinePublic {
    return PipelinePublicSchema.parse(pipeline);
  }

  async create(input: PipelineCreate): Promise<PipelinePublic> {
    let body: PipelineCreate;
    try {
      body = PipelineCreateSchema.parse(input);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
    const exists = await this.repo.findOne({ where: { id: body.id } });
    if (exists) throw new ConflictException(`already exists: ${body.id}`);
    await this.assertAgentsExist(body.steps);
    this.assertGraphValid(body);
    return this.toPublic(await this.write(body as Pipeline));
  }

  async createForUser(
    userId: string,
    input: PipelineCreate,
  ): Promise<PipelinePublic> {
    let body: PipelineCreate;
    try {
      body = PipelineCreateSchema.parse(input);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
    const teamId = (body.team_id || "").trim();
    if (!teamId) {
      throw new BadRequestException("team_id is required");
    }
    await this.teams.requireWritableMember(teamId, userId);
    const created = await this.create({ ...body, team_id: teamId });
    this.scheduleAudit({
      team_id: teamId,
      actor_user_id: userId,
      actor_name: await this.actorLabel(userId),
      action: "pipeline.create",
      resource_type: "pipeline",
      resource_id: created.id,
      summary: `创建流水线 ${created.name || created.id}`,
    });
    return created;
  }

  async update(id: string, patch: PipelineUpdate): Promise<PipelinePublic> {
    const current = await this.get(id);
    try {
      const parsed = PipelineUpdateSchema.parse(patch);
      const merged = PipelineSchema.parse({
        ...current,
        ...parsed,
        id,
        team_id: current.team_id,
        source: { ...current.source, ...(parsed.source || {}) },
        defaults: { ...current.defaults, ...(parsed.defaults || {}) },
        steps: parsed.steps || current.steps,
      });
      await this.assertAgentsExist(merged.steps);
      this.assertGraphValid(merged);
      return this.toPublic(await this.write(merged));
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async updateForUser(
    userId: string,
    id: string,
    patch: PipelineUpdate,
  ): Promise<PipelinePublic> {
    const current = await this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    const updated = await this.update(id, patch);
    this.scheduleAudit({
      team_id: current.team_id,
      actor_user_id: userId,
      actor_name: await this.actorLabel(userId),
      action: "pipeline.update",
      resource_type: "pipeline",
      resource_id: id,
      summary: `更新流水线 ${updated.name || id}`,
      detail: { keys: Object.keys(patch || {}) },
    });
    return updated;
  }

  async setEnabled(id: string, enabled: boolean): Promise<PipelinePublic> {
    return this.toPublic(
      await this.write({ ...(await this.get(id)), enabled }),
    );
  }

  async setEnabledForUser(
    userId: string,
    id: string,
    enabled: boolean,
  ): Promise<PipelinePublic> {
    const current = await this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    const updated = await this.setEnabled(id, enabled);
    this.scheduleAudit({
      team_id: current.team_id,
      actor_user_id: userId,
      actor_name: await this.actorLabel(userId),
      action: enabled ? "pipeline.enable" : "pipeline.disable",
      resource_type: "pipeline",
      resource_id: id,
      summary: `${enabled ? "启用" : "停用"}流水线 ${updated.name || id}`,
    });
    return updated;
  }

  async remove(id: string) {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`not found: ${id}`);
    await this.repo.remove(entity);
    return { ok: true as const, id };
  }

  async removeForUser(userId: string, id: string) {
    const current = await this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    const removed = await this.remove(id);
    this.scheduleAudit({
      team_id: current.team_id,
      actor_user_id: userId,
      actor_name: await this.actorLabel(userId),
      action: "pipeline.delete",
      resource_type: "pipeline",
      resource_id: id,
      summary: `删除流水线 ${current.name || id}`,
    });
    return removed;
  }

  async seedDefaults(teamId = "") {
    const imported: string[] = [];
    const skipped: string[] = [];
    for (const item of DEFAULT_PIPELINES) {
      const exists = await this.repo.findOne({ where: { id: item.id } });
      if (exists) {
        skipped.push(item.id);
        continue;
      }
      try {
        await this.assertAgentsExist(item.steps);
        this.assertGraphValid(item);
        await this.write(
          PipelineSchema.parse({ ...item, team_id: teamId || "" }),
        );
        imported.push(item.id);
      } catch (err) {
        throw new BadRequestException(
          `seed failed for ${item.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return {
      imported,
      skipped,
      total: (await this.list()).length,
    };
  }

  async seedDefaultsForUser(userId: string, teamId: string) {
    const tid = (teamId || "").trim();
    if (!tid) throw new BadRequestException("team_id is required");
    await this.teams.requireWritableMember(tid, userId);
    return this.seedDefaults(tid);
  }

  async compose(input: unknown) {
    const body = PipelineComposeSchema.parse(input);
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

    const agentDraft = await this.tryComposeViaBridge(
      body.prompt,
      body.team_id,
    );
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
    draft.source = {
      kind: "nl",
      nl_prompt: body.prompt,
      template_id:
        draft.source?.template_id ||
        (generatedBy === "agent" ? "agent" : draft.source?.template_id),
    };
    await this.assertAgentsExist(draft.steps);
    this.assertGraphValid(draft);
    if (body.save) {
      const exists = await this.repo.findOne({ where: { id: draft.id } });
      if (exists) {
        throw new ConflictException(`already exists: ${draft.id}`);
      }
      return {
        draft: this.toPublic(
          await this.write(PipelineSchema.parse(draft)),
        ),
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
    if (body.team_id?.trim()) {
      await this.teams.assertTeamAccess(body.team_id.trim(), userId);
    }
    return this.compose(body);
  }

  private async tryComposeViaBridge(
    prompt: string,
    teamId?: string,
  ): Promise<
    | {
        ok: true;
        draft: PipelineCreate;
        driver?: string;
        dryRun?: boolean;
      }
    | { ok: false; reason: string }
  > {
    const agents = (await this.humans.list({ enabled: "true" })).map((h) => ({
      id: h.id,
      name: h.name,
      role: h.role,
      description: h.description || "",
    }));
    if (!agents.length) {
      return { ok: false, reason: "no enabled digital humans" };
    }

    const tid = (teamId || "").trim();
    const configured = this.studioConfig.getEffectiveForTeam(tid).bridge_base_url;
    const bridgeBase = resolveBridgeBaseUrl(configured);
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
        await this.assertAgentsExist(draft.steps);
        this.assertGraphValid(draft);
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

  private async write(pipeline: Pipeline): Promise<Pipeline> {
    const stamp = this.nowIso();
    const existing = await this.repo.findOne({ where: { id: pipeline.id } });
    const next = PipelineSchema.parse({
      ...pipeline,
      created_at:
        pipeline.created_at ||
        existing?.created_at?.toISOString?.() ||
        stamp,
      updated_at: stamp,
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
    return this.get(next.id);
  }
}
