import { Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  RunLogEntrySchema,
  RunLogMetaSchema,
  type RunLogAppend,
  type RunLogEntry,
  type RunLogMeta,
  type RunLogSource,
  type WorkOrder,
} from "@agent-studio/agent-schema";

@Injectable()
export class RunLogsService implements OnModuleInit {
  private dataDir = "";

  onModuleInit() {
    this.dataDir = path.resolve(
      process.env.STUDIO_RUN_LOG_DIR ||
        path.join(process.cwd(), "data", "run-logs"),
    );
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  private runDir(runId: string) {
    return path.join(this.dataDir, runId);
  }

  private metaPath(runId: string) {
    return path.join(this.runDir(runId), "meta.yaml");
  }

  private eventsPath(runId: string) {
    return path.join(this.runDir(runId), "events.jsonl");
  }

  private nowIso() {
    return new Date().toISOString();
  }

  ensureRun(meta: {
    run_id: string;
    work_order_id: string;
    title?: string;
    pipeline_id?: string;
    pipeline_name?: string;
    executor?: string;
    project_id?: string;
    work_order_status?: string;
    started_at?: string;
  }): RunLogMeta {
    const dir = this.runDir(meta.run_id);
    fs.mkdirSync(dir, { recursive: true });
    const existing = this.readMeta(meta.run_id);
    const next = RunLogMetaSchema.parse({
      run_id: meta.run_id,
      work_order_id: meta.work_order_id,
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
    this.writeMeta(next);
    return next;
  }

  /** Sync meta fields from current work order (status / title). */
  touchFromOrder(order: WorkOrder) {
    const run = order.run;
    if (!run?.run_id) return;
    if (!fs.existsSync(this.runDir(run.run_id))) {
      this.ensureRun({
        run_id: run.run_id,
        work_order_id: order.id,
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
    const meta = this.readMeta(run.run_id);
    if (!meta) return;
    this.writeMeta(
      RunLogMetaSchema.parse({
        ...meta,
        title: order.title,
        work_order_status: order.status,
        project_id: order.project_id || meta.project_id,
        updated_at: this.nowIso(),
      }),
    );
  }

  append(input: RunLogAppend): RunLogEntry {
    const entry = RunLogEntrySchema.parse({
      ...input,
      id: input.id || randomUUID().slice(0, 10),
      at: input.at || this.nowIso(),
      body: input.body || "",
    });
    this.ensureRun({
      run_id: entry.run_id,
      work_order_id: entry.work_order_id,
    });
    fs.appendFileSync(this.eventsPath(entry.run_id), `${JSON.stringify(entry)}\n`, "utf8");

    const meta = this.readMeta(entry.run_id)!;
    const sources = new Set<RunLogSource>(meta.sources || []);
    sources.add(entry.source);
    this.writeMeta(
      RunLogMetaSchema.parse({
        ...meta,
        entry_count: (meta.entry_count || 0) + 1,
        sources: [...sources],
        updated_at: entry.at,
      }),
    );
    return entry;
  }

  /** Convenience: log from a work order context. */
  log(
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
  ): RunLogEntry | null {
    const run = order.run;
    if (!run?.run_id) return null;
    this.ensureRun({
      run_id: run.run_id,
      work_order_id: order.id,
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

  list(filters?: {
    q?: string;
    work_order_id?: string;
    limit?: number;
  }): { items: RunLogMeta[]; total: number } {
    if (!fs.existsSync(this.dataDir)) {
      return { items: [], total: 0 };
    }
    const dirs = fs
      .readdirSync(this.dataDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    let items = dirs
      .map((id) => this.readMeta(id))
      .filter((m): m is RunLogMeta => Boolean(m));

    if (filters?.work_order_id) {
      items = items.filter((m) => m.work_order_id === filters.work_order_id);
    }
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

  get(runId: string, filters?: { source?: string; level?: string }) {
    const meta = this.readMeta(runId);
    if (!meta) throw new NotFoundException(`run log not found: ${runId}`);
    let entries = this.readEntries(runId);
    if (filters?.source && filters.source !== "all") {
      entries = entries.filter((e) => e.source === filters.source);
    }
    if (filters?.level && filters.level !== "all") {
      entries = entries.filter((e) => e.level === filters.level);
    }
    return { meta, entries, total: entries.length };
  }

  private readMeta(runId: string): RunLogMeta | null {
    const fp = this.metaPath(runId);
    if (!fs.existsSync(fp)) return null;
    try {
      return RunLogMetaSchema.parse(YAML.parse(fs.readFileSync(fp, "utf8")));
    } catch {
      return null;
    }
  }

  private writeMeta(meta: RunLogMeta) {
    fs.mkdirSync(this.runDir(meta.run_id), { recursive: true });
    fs.writeFileSync(
      this.metaPath(meta.run_id),
      `# Run log ${meta.run_id}\n${YAML.stringify(meta, { lineWidth: 100 })}`,
      "utf8",
    );
  }

  private readEntries(runId: string): RunLogEntry[] {
    const fp = this.eventsPath(runId);
    if (!fs.existsSync(fp)) return [];
    const lines = fs.readFileSync(fp, "utf8").split("\n").filter(Boolean);
    const out: RunLogEntry[] = [];
    for (const line of lines) {
      try {
        out.push(RunLogEntrySchema.parse(JSON.parse(line)));
      } catch {
        /* skip corrupt lines */
      }
    }
    return out;
  }
}
