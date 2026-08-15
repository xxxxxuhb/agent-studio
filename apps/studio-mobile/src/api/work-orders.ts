import { get, post, put } from "../http";
import type { WorkOrder, WorkOrderCreate } from "@agent-studio/agent-schema";

export const workOrdersApi = {
  list(params: { q?: string; status?: string; team_id?: string }) {
    return get<{ items: WorkOrder[]; total: number }>("/work-orders", {
      params,
    });
  },
  get(id: string) {
    return get<WorkOrder>(`/work-orders/${id}`);
  },
  create(body: WorkOrderCreate) {
    return post<WorkOrder>("/work-orders", body);
  },
  update(id: string, body: Partial<WorkOrderCreate>) {
    return put<WorkOrder>(`/work-orders/${id}`, body);
  },
  start(
    id: string,
    body: {
      pipeline_id: string;
      executor?: "studio";
      auto_approve?: boolean;
      preferred_bridge_id?: string;
    },
  ) {
    return post<WorkOrder>(`/work-orders/${id}/start`, body, {
      timeout: 60_000,
    });
  },
  restart(
    id: string,
    body: {
      pipeline_id?: string;
      executor?: "studio";
      auto_approve?: boolean;
      preferred_bridge_id?: string;
      feedback?: string;
    } = {},
  ) {
    return post<WorkOrder>(`/work-orders/${id}/restart`, body, {
      timeout: 60_000,
    });
  },
  decide(
    id: string,
    decision: "approve" | "reject",
    feedback = "",
  ) {
    return post<WorkOrder>(`/work-orders/${id}/decision`, {
      decision,
      feedback,
    });
  },
  resume(id: string, body: { feedback?: string } = {}) {
    return post<WorkOrder>(`/work-orders/${id}/resume`, body, {
      timeout: 60_000,
    });
  },
  cancel(id: string, feedback = "移动端结束运行") {
    return post<WorkOrder>(`/work-orders/${id}/cancel`, { feedback });
  },
};

export function genWorkOrderId() {
  return `wo-${Date.now().toString(36)}`;
}
