import { get } from "../http";
import type { RunLogEntry, RunLogMeta } from "@agent-studio/agent-schema";

export type RunLogTraceStep = {
  at: string;
  kind: string;
  label: string;
  level?: string;
  bridge_stage?: string;
  event_type?: string;
};

export const runLogsApi = {
  list(
    params: {
      q?: string;
      work_order_id?: string;
      team_id?: string;
      limit?: number;
    } = {},
  ) {
    return get<{ items: RunLogMeta[]; total: number }>("/run-logs", { params });
  },
  lookup(params: { q: string; team_id?: string }) {
    return get<{ meta: RunLogMeta; match: "exact" | "fuzzy" }>(
      "/run-logs/lookup",
      { params },
    );
  },
  get(
    runId: string,
    params: { source?: string; level?: string } = {},
  ) {
    return get<{
      meta: RunLogMeta;
      entries: RunLogEntry[];
      total: number;
      trace: RunLogTraceStep[];
    }>(`/run-logs/${runId}`, { params });
  },
  listArtifacts(runId: string) {
    return get<{
      studio_run_id: string;
      bridge_run_id: string;
      bridge_base_url: string;
      root: string;
      items: RunArtifactListItem[];
    }>(`/run-logs/${encodeURIComponent(runId)}/artifacts`);
  },
  readArtifact(runId: string, name: string) {
    return get<{
      name: string;
      bytes: number;
      updated_at: string;
      content_type: string;
      content: string;
      role?: string;
    }>(
      `/run-logs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(name)}`,
    );
  },
};

export type RunArtifactListItem = {
  name: string;
  bytes: number;
  updated_at: string;
  role?: string;
};
