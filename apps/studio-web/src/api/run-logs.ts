import { get } from "../http";
import type { RunLogEntry, RunLogMeta } from "@agent-studio/agent-schema";

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
  get(
    runId: string,
    params: { source?: string; level?: string } = {},
  ) {
    return get<{ meta: RunLogMeta; entries: RunLogEntry[]; total: number }>(
      `/run-logs/${runId}`,
      { params },
    );
  },
};
