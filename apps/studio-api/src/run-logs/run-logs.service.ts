import { Injectable, NotFoundException } from "@nestjs/common";
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
import { RunLogEntryEntity } from "./entities/run-log-entry.entity";
import { RunLogMetaEntity } from "./entities/run-log-meta.entity";

@Injectable()
export class RunLogsService {
  constructor(
    @InjectRepository(RunLogMetaEntity)
    private readonly metas: Repository<RunLogMetaEntity>,
    @InjectRepository(RunLogEntryEntity)
    private readonly entries: Repository<RunLogEntryEntity>,
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
      started_at: existing?.started_at || meta.started_at || this.nowIso(),
      updated_at: this.nowIso(),
      entry_count: existing?.entry_count ?? 0,
      sources: existing?.sources ?? [],
    });
    return this.saveMeta(next);
  }

  /** Sync meta fields from current work order (status / title). */
  async touchFromOrder(order: WorkOrder) {
    const run = order.run;
    if (!run?.run_id) return;
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
    await this.saveMeta(
      RunLogMetaSchema.parse({
        ...meta,
        entry_count: entryCount,
        sources: [...sources],
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

    let items = (await this.metas.find({ where })).map((e) => this.toMeta(e));

    if (filters?.q?.trim()) {
      const n = filters.q.trim().toLowerCase();
      items = items.filter(
        (m) =>
          m.run_id.toLowerCase().includes(n) ||
          m.work_order_id.toLowerCase().includes(n) ||
          (m.title || "").toLowerCase().includes(n) ||
          (m.pipeline_name || "").toLowerCase().includes(n) ||
          (m.pipeline_id || "").toLowerCase().includes(n),
      );
    }

    items.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    const limit = filters?.limit && filters.limit > 0 ? filters.limit : 200;
    const sliced = items.slice(0, limit);
    return { items: sliced, total: items.length };
  }

  async get(runId: string, filters?: { source?: string; level?: string }) {
    const metaEntity = await this.metas.findOne({ where: { run_id: runId } });
    if (!metaEntity) throw new NotFoundException(`run log not found: ${runId}`);
    const meta = this.toMeta(metaEntity);

    const where: Record<string, unknown> = { run_id: runId };
    if (filters?.source && filters.source !== "all") {
      where.source = filters.source;
    }
    if (filters?.level && filters.level !== "all") {
      where.level = filters.level;
    }
    const rows = await this.entries.find({
      where,
      order: { at: "ASC" },
    });
    const entryList = rows.map((e) => this.toEntry(e));
    return { meta, entries: entryList, total: entryList.length };
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
