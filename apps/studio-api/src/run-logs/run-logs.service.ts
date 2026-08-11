import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { In, Repository } from "typeorm";
import {
  RunLogEntrySchema,
  RunLogMetaSchema,
  type RunLogAppend,
  type RunLogEntry,
  type RunLogMeta,
  type RunLogSource,
  type WorkOrder,
} from "@agent-studio/agent-schema";
import { bridgeAuthHeaders } from "../bridges/bridge-http";
import { BridgesService } from "../bridges/bridges.service";
import { RunLogEntryEntity } from "./entities/run-log-entry.entity";
import { RunLogMetaEntity } from "./entities/run-log-meta.entity";
import {
  buildRunLogTrace,
  looksLikeCorrelationId,
  type RunLogTraceStep,
} from "./run-log-trace";

export type { RunLogTraceStep };

function pathBasenameOnly(name: string): string {
  const raw = String(name || "").trim();
  if (!raw || raw.includes("/") || raw.includes("\\") || raw.includes("..")) {
    throw new BadRequestException("artifact name must be a single file name");
  }
  return raw;
}

@Injectable()
export class RunLogsService {
  constructor(
    @InjectRepository(RunLogMetaEntity)
    private readonly metas: Repository<RunLogMetaEntity>,
    @InjectRepository(RunLogEntryEntity)
    private readonly entries: Repository<RunLogEntryEntity>,
    private readonly bridges: BridgesService,
  ) {}

  private nowIso() {
    return new Date().toISOString();
  }

  private toMeta(entity: RunLogMetaEntity): RunLogMeta {
    return RunLogMetaSchema.parse({
      run_id: entity.run_id,
      work_order_id: entity.work_order_id,
      team_id: entity.team_id || "",
      title: entity.title || "",
      pipeline_id: entity.pipeline_id || "",
      pipeline_name: entity.pipeline_name || "",
      executor: entity.executor || "",
      project_id: entity.project_id || "",
      work_order_status: entity.work_order_status || "",
      dify_workflow_run_id: entity.dify_workflow_run_id || "",
      bridge_run_id: entity.bridge_run_id || "",
      bridge_stage: entity.bridge_stage || "",
      last_error: entity.last_error || "",
      started_at: entity.started_at,
      updated_at: entity.updated_at,
      entry_count: entity.entry_count || 0,
      sources: entity.sources || [],
    });
  }

  private toEntry(entity: RunLogEntryEntity): RunLogEntry {
    return RunLogEntrySchema.parse({
      id: entity.id,
      at: entity.at,
      run_id: entity.run_id,
      work_order_id: entity.work_order_id,
      source: entity.source,
      level: entity.level || "info",
      message: entity.message,
      body: entity.body || "",
      step_id: entity.step_id || undefined,
      agent: entity.agent || undefined,
      bridge_stage: entity.bridge_stage || undefined,
      event_type: entity.event_type || undefined,
      detail: entity.detail || undefined,
    });
  }

  private correlationFromOrder(order: WorkOrder): {
    dify_workflow_run_id: string;
    bridge_run_id: string;
    bridge_stage: string;
    last_error: string;
  } {
    const dify = order.run?.dify;
    const lastBridgeStage = [...(order.run?.events || [])]
      .reverse()
      .find((e) => e.type === "bridge_stage" && e.bridge_stage)?.bridge_stage;
    const err = (dify?.error || "").trim() || (dify?.raw_summary || "").trim();
    const lastError =
      order.status === "failed" ||
      dify?.status === "failed" ||
      /失败|error|503|不可达/i.test(err)
        ? err.slice(0, 2000)
        : (dify?.error || "").trim().slice(0, 2000);
    return {
      dify_workflow_run_id: (dify?.workflow_run_id || "").trim(),
      bridge_run_id: (dify?.bridge_run_id || "").trim(),
      bridge_stage: (lastBridgeStage || "").trim(),
      last_error: lastError,
    };
  }

  private async saveMeta(meta: RunLogMeta): Promise<RunLogMeta> {
    const next = RunLogMetaSchema.parse(meta);
    await this.metas.save({
      run_id: next.run_id,
      work_order_id: next.work_order_id,
      team_id: next.team_id || "",
      title: next.title || "",
      pipeline_id: next.pipeline_id || "",
      pipeline_name: next.pipeline_name || "",
      executor: next.executor || "",
      project_id: next.project_id || "",
      work_order_status: next.work_order_status || "",
      dify_workflow_run_id: next.dify_workflow_run_id || "",
      bridge_run_id: next.bridge_run_id || "",
      bridge_stage: next.bridge_stage || "",
      last_error: next.last_error || "",
      started_at: next.started_at,
      updated_at: next.updated_at,
      entry_count: next.entry_count || 0,
      sources: next.sources || [],
    });
    return next;
  }

  async ensureRun(meta: {
    run_id: string;
    work_order_id: string;
    team_id?: string;
    title?: string;
    pipeline_id?: string;
    pipeline_name?: string;
    executor?: string;
    project_id?: string;
    work_order_status?: string;
    dify_workflow_run_id?: string;
    bridge_run_id?: string;
    bridge_stage?: string;
    last_error?: string;
    started_at?: string;
  }): Promise<RunLogMeta> {
    const existing = await this.metas.findOne({
      where: { run_id: meta.run_id },
    });
    const next = RunLogMetaSchema.parse({
      run_id: meta.run_id,
      work_order_id: meta.work_order_id,
      team_id: meta.team_id ?? existing?.team_id ?? "",
      title: meta.title ?? existing?.title ?? "",
      pipeline_id: meta.pipeline_id ?? existing?.pipeline_id ?? "",
      pipeline_name: meta.pipeline_name ?? existing?.pipeline_name ?? "",
      executor: meta.executor ?? existing?.executor ?? "",
      project_id: meta.project_id ?? existing?.project_id ?? "",
      work_order_status:
        meta.work_order_status ?? existing?.work_order_status ?? "",
      dify_workflow_run_id:
        meta.dify_workflow_run_id ?? existing?.dify_workflow_run_id ?? "",
      bridge_run_id: meta.bridge_run_id ?? existing?.bridge_run_id ?? "",
      bridge_stage: meta.bridge_stage ?? existing?.bridge_stage ?? "",
      last_error: meta.last_error ?? existing?.last_error ?? "",
      started_at: existing?.started_at || meta.started_at || this.nowIso(),
      updated_at: this.nowIso(),
      entry_count: existing?.entry_count ?? 0,
      sources: existing?.sources ?? [],
    });
    return this.saveMeta(next);
  }

  /** Sync meta fields from current work order (status / title / correlation IDs). */
  async touchFromOrder(order: WorkOrder) {
    const run = order.run;
    if (!run?.run_id) return;
    const corr = this.correlationFromOrder(order);
    const existing = await this.metas.findOne({
      where: { run_id: run.run_id },
    });
    if (!existing) {
      await this.ensureRun({
        run_id: run.run_id,
        work_order_id: order.id,
        team_id: order.team_id,
        title: order.title,
        pipeline_id: run.pipeline_id,
        pipeline_name: run.pipeline_name,
        executor: run.executor,
        project_id: order.project_id,
        work_order_status: order.status,
        started_at: run.started_at,
        ...corr,
      });
      return;
    }
    await this.saveMeta(
      RunLogMetaSchema.parse({
        ...this.toMeta(existing),
        title: order.title,
        team_id: order.team_id || existing.team_id,
        work_order_status: order.status,
        project_id: order.project_id || existing.project_id,
        dify_workflow_run_id:
          corr.dify_workflow_run_id || existing.dify_workflow_run_id || "",
        bridge_run_id: corr.bridge_run_id || existing.bridge_run_id || "",
        bridge_stage: corr.bridge_stage || existing.bridge_stage || "",
        last_error: corr.last_error || existing.last_error || "",
        updated_at: this.nowIso(),
      }),
    );
  }

  async append(input: RunLogAppend): Promise<RunLogEntry> {
    const entry = RunLogEntrySchema.parse({
      ...input,
      id: input.id || randomUUID().slice(0, 10),
      at: input.at || this.nowIso(),
      body: input.body || "",
    });
    await this.ensureRun({
      run_id: entry.run_id,
      work_order_id: entry.work_order_id,
    });

    // Upsert by id so re-appends / migration are idempotent
    await this.entries.save({
      id: entry.id,
      run_id: entry.run_id,
      work_order_id: entry.work_order_id,
      at: entry.at,
      source: entry.source,
      level: entry.level || "info",
      message: entry.message,
      body: entry.body || "",
      step_id: entry.step_id || "",
      agent: entry.agent || "",
      bridge_stage: entry.bridge_stage || "",
      event_type: entry.event_type || "",
      detail: entry.detail || null,
    });

    const metaEntity = await this.metas.findOne({
      where: { run_id: entry.run_id },
    });
    if (!metaEntity) return entry;
    const meta = this.toMeta(metaEntity);
    const sources = new Set<RunLogSource>(meta.sources || []);
    sources.add(entry.source);
    const entryCount = await this.entries.count({
      where: { run_id: entry.run_id },
    });
    const detailBridge =
      typeof entry.detail?.bridge_run_id === "string"
        ? entry.detail.bridge_run_id
        : "";
    await this.saveMeta(
      RunLogMetaSchema.parse({
        ...meta,
        entry_count: entryCount,
        sources: [...sources],
        bridge_run_id: detailBridge || meta.bridge_run_id || "",
        bridge_stage: entry.bridge_stage || meta.bridge_stage || "",
        last_error:
          entry.level === "error" || entry.level === "warn"
            ? entry.message.slice(0, 2000) || meta.last_error
            : meta.last_error,
        updated_at: entry.at,
      }),
    );
    return entry;
  }

  /** Convenience: log from a work order context. */
  async log(
    order: WorkOrder,
    partial: {
      source: RunLogSource;
      message: string;
      level?: RunLogEntry["level"];
      body?: string;
      step_id?: string;
      agent?: string;
      bridge_stage?: string;
      event_type?: string;
      detail?: Record<string, unknown>;
      id?: string;
      at?: string;
    },
  ): Promise<RunLogEntry | null> {
    const run = order.run;
    if (!run?.run_id) return null;
    const corr = this.correlationFromOrder(order);
    await this.ensureRun({
      run_id: run.run_id,
      work_order_id: order.id,
      team_id: order.team_id,
      title: order.title,
      pipeline_id: run.pipeline_id,
      pipeline_name: run.pipeline_name,
      executor: run.executor,
      project_id: order.project_id,
      work_order_status: order.status,
      started_at: run.started_at,
      ...corr,
    });
    return this.append({
      run_id: run.run_id,
      work_order_id: order.id,
      source: partial.source,
      level: partial.level || "info",
      message: partial.message,
      body: partial.body || "",
      step_id: partial.step_id,
      agent: partial.agent,
      bridge_stage: partial.bridge_stage,
      event_type: partial.event_type,
      detail: partial.detail,
      id: partial.id,
      at: partial.at,
    });
  }

  async list(filters?: {
    q?: string;
    work_order_id?: string;
    team_id?: string;
    team_ids?: string[];
    limit?: number;
  }): Promise<{ items: RunLogMeta[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filters?.work_order_id) {
      where.work_order_id = filters.work_order_id;
    }
    if (filters?.team_id) {
      where.team_id = filters.team_id;
    } else if (filters?.team_ids) {
      if (!filters.team_ids.length) {
        return { items: [], total: 0 };
      }
      where.team_id = In(filters.team_ids);
    }

    const limit = filters?.limit && filters.limit > 0 ? filters.limit : 200;
    const qRaw = filters?.q?.trim() || "";

    // Fast path: exact correlation-id match on indexed meta columns.
    if (qRaw && looksLikeCorrelationId(qRaw)) {
      const exactRows = await this.metas.find({
        where: [
          { ...where, run_id: qRaw },
          { ...where, work_order_id: qRaw },
          { ...where, dify_workflow_run_id: qRaw },
          { ...where, bridge_run_id: qRaw },
        ],
      });
      if (exactRows.length) {
        const items = exactRows
          .map((e) => this.toMeta(e))
          .sort((a, b) =>
            (b.updated_at || "").localeCompare(a.updated_at || ""),
          );
        return { items: items.slice(0, limit), total: items.length };
      }
    }

    let items = (await this.metas.find({ where })).map((e) => this.toMeta(e));

    if (qRaw) {
      const n = qRaw.toLowerCase();
      const entryHits = await this.entries
        .createQueryBuilder("e")
        .select("DISTINCT e.run_id", "run_id")
        .where(
          "(LOWER(e.message) LIKE :q OR LOWER(IFNULL(e.body, '')) LIKE :q OR LOWER(IFNULL(e.bridge_stage, '')) LIKE :q)",
          { q: `%${n}%` },
        )
        .getRawMany<{ run_id: string }>();
      const hitIds = new Set(entryHits.map((r) => r.run_id));
      items = items.filter(
        (m) =>
          hitIds.has(m.run_id) ||
          m.run_id.toLowerCase().includes(n) ||
          m.work_order_id.toLowerCase().includes(n) ||
          (m.title || "").toLowerCase().includes(n) ||
          (m.pipeline_name || "").toLowerCase().includes(n) ||
          (m.pipeline_id || "").toLowerCase().includes(n) ||
          (m.dify_workflow_run_id || "").toLowerCase().includes(n) ||
          (m.bridge_run_id || "").toLowerCase().includes(n) ||
          (m.bridge_stage || "").toLowerCase().includes(n) ||
          (m.last_error || "").toLowerCase().includes(n),
      );
    }

    items.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    const sliced = items.slice(0, limit);
    return { items: sliced, total: items.length };
  }

  /**
   * Resolve a Studio / Dify / Bridge / work-order id to a single run meta.
   * Prefer exact indexed match; fall back to list(q) first hit.
   */
  async lookup(opts: {
    q: string;
    team_ids?: string[];
  }): Promise<{ meta: RunLogMeta; match: "exact" | "fuzzy" } | null> {
    const q = (opts.q || "").trim();
    if (!q) return null;

    const where: Record<string, unknown> = {};
    if (opts.team_ids) {
      if (!opts.team_ids.length) return null;
      where.team_id = In(opts.team_ids);
    }

    if (looksLikeCorrelationId(q)) {
      const exact = await this.metas.find({
        where: [
          { ...where, run_id: q },
          { ...where, work_order_id: q },
          { ...where, dify_workflow_run_id: q },
          { ...where, bridge_run_id: q },
        ],
        order: { updated_at: "DESC" },
        take: 1,
      });
      if (exact[0]) {
        return { meta: this.toMeta(exact[0]), match: "exact" };
      }
    }

    const soft = await this.list({
      q,
      team_ids: opts.team_ids,
      limit: 1,
    });
    if (soft.items[0]) {
      return { meta: soft.items[0], match: "fuzzy" };
    }
    return null;
  }

  async get(runId: string, filters?: { source?: string; level?: string }) {
    const metaEntity = await this.metas.findOne({ where: { run_id: runId } });
    if (!metaEntity) throw new NotFoundException(`run log not found: ${runId}`);
    const meta = this.toMeta(metaEntity);

    const allRows = await this.entries.find({
      where: { run_id: runId },
      order: { at: "ASC" },
    });
    const allEntries = allRows.map((e) => this.toEntry(e));
    const entryList = allEntries.filter((e) => {
      if (filters?.source && filters.source !== "all" && e.source !== filters.source) {
        return false;
      }
      if (filters?.level && filters.level !== "all" && e.level !== filters.level) {
        return false;
      }
      return true;
    });
    const trace = buildRunLogTrace(allEntries);
    return { meta, entries: entryList, total: entryList.length, trace };
  }

  private async bridgeBaseForMeta(meta: RunLogMeta): Promise<{
    bridgeRunId: string;
    studioBaseUrl: string;
  }> {
    const bridgeRunId = (meta.bridge_run_id || "").trim();
    if (!bridgeRunId) {
      throw new BadRequestException(
        "该运行尚无 bridge_run_id，无法读取 Bridge 产物（流水线执行到 Bridge 阶段后才会写入）",
      );
    }
    const studioBaseUrl = await this.bridges.pickRegisteredBaseUrl({
      teamId: meta.team_id,
    });
    if (!studioBaseUrl) {
      throw new BadRequestException(
        "无在线 Bridge：请确认执行器已注册且在线后再查看产物",
      );
    }
    return { bridgeRunId, studioBaseUrl };
  }

  /** Proxy Bridge GET /runs/:bridgeRunId/artifacts (team-scoped via run meta). */
  async listArtifacts(studioRunId: string) {
    const metaEntity = await this.metas.findOne({
      where: { run_id: studioRunId },
    });
    if (!metaEntity) {
      throw new NotFoundException(`run log not found: ${studioRunId}`);
    }
    const meta = this.toMeta(metaEntity);
    const { bridgeRunId, studioBaseUrl } = await this.bridgeBaseForMeta(meta);
    const url = `${studioBaseUrl}/runs/${encodeURIComponent(bridgeRunId)}/artifacts`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: bridgeAuthHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new BadRequestException(
        `Bridge 不可达（产物列表）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BadRequestException(
        `Bridge 产物列表失败 HTTP ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    const body = (await res.json()) as {
      run_id?: string;
      root?: string;
      items?: Array<{
        name: string;
        bytes: number;
        updated_at: string;
        role?: string;
      }>;
    };
    return {
      studio_run_id: studioRunId,
      bridge_run_id: bridgeRunId,
      bridge_base_url: studioBaseUrl,
      root: body.root || "",
      items: body.items || [],
    };
  }

  async readArtifact(studioRunId: string, name: string) {
    const metaEntity = await this.metas.findOne({
      where: { run_id: studioRunId },
    });
    if (!metaEntity) {
      throw new NotFoundException(`run log not found: ${studioRunId}`);
    }
    const meta = this.toMeta(metaEntity);
    const { bridgeRunId, studioBaseUrl } = await this.bridgeBaseForMeta(meta);
    const safeName = pathBasenameOnly(name);
    const url = `${studioBaseUrl}/runs/${encodeURIComponent(bridgeRunId)}/artifacts/${encodeURIComponent(safeName)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: bridgeAuthHeaders(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new BadRequestException(
        `Bridge 不可达（读产物）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (res.status === 404) {
      throw new NotFoundException(`artifact not found: ${safeName}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BadRequestException(
        `Bridge 读产物失败 HTTP ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    return res.json();
  }

  /** Used by bootstrap migrate: insert meta + entries if run_id missing. */
  async importFromFiles(meta: RunLogMeta, entries: RunLogEntry[]) {
    const exists = await this.metas.findOne({ where: { run_id: meta.run_id } });
    if (exists) return false;
    await this.saveMeta(
      RunLogMetaSchema.parse({
        ...meta,
        entry_count: entries.length,
        sources: [
          ...new Set([
            ...(meta.sources || []),
            ...entries.map((e) => e.source),
          ]),
        ],
      }),
    );
    for (const entry of entries) {
      const parsed = RunLogEntrySchema.safeParse(entry);
      if (!parsed.success) continue;
      const e = parsed.data;
      await this.entries.save({
        id: e.id,
        run_id: e.run_id,
        work_order_id: e.work_order_id,
        at: e.at,
        source: e.source,
        level: e.level || "info",
        message: e.message,
        body: e.body || "",
        step_id: e.step_id || "",
        agent: e.agent || "",
        bridge_stage: e.bridge_stage || "",
        event_type: e.event_type || "",
        detail: e.detail || null,
      });
    }
    return true;
  }
}
