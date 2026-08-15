import { get } from "../http";

export type UsageEvent = {
  id: string;
  at: string;
  team_id: string;
  work_order_id: string;
  run_id: string;
  bridge_run_id: string;
  step_id: string;
  stage: string;
  driver: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: string | null;
  dry_run: number;
};

export type UsageSummary = {
  team_id: string;
  events: number;
  total_tokens: number;
  cost_usd: number;
  by_driver: Record<
    string,
    { events: number; total_tokens: number; cost_usd: number }
  >;
};

export type AuditLog = {
  id: string;
  at: string;
  team_id: string;
  actor_user_id: string;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string;
  summary: string;
  detail: Record<string, unknown> | null;
};

export const usageApi = {
  list(params: {
    team_id: string;
    work_order_id?: string;
    driver?: string;
    limit?: number;
  }) {
    return get<{ items: UsageEvent[]; total: number }>("/usage", { params });
  },
  summary(params: { team_id: string }) {
    return get<UsageSummary>("/usage/summary", { params });
  },
};

export const auditApi = {
  list(params: {
    team_id: string;
    actor_user_id?: string;
    action?: string;
    limit?: number;
  }) {
    return get<{ items: AuditLog[]; total: number }>("/audit-logs", {
      params,
    });
  },
};
