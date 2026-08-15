import { get } from "../http";
import type { RunLogEntry, RunLogMeta } from "@agent-studio/agent-schema";

export type RunArtifactListItem = {
  name: string;
  bytes: number;
  updated_at: string;
  role?: string;
  source?: "bridge" | "stored";
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
    return get<{ items: RunLogMeta[]; total: number }>("/run-logs", {
      params,
    });
  },
  get(runId: string) {
    return get<{
      meta: RunLogMeta;
      entries: RunLogEntry[];
      total: number;
    }>(`/run-logs/${encodeURIComponent(runId)}`);
  },
  listArtifacts(runId: string) {
    return get<{
      items: RunArtifactListItem[];
      hint?: string;
    }>(`/run-logs/${encodeURIComponent(runId)}/artifacts`);
  },
  readArtifact(runId: string, name: string) {
    return get<{
      name: string;
      bytes: number;
      content_type: string;
      content: string;
    }>(
      `/run-logs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(name)}`,
    );
  },
};
