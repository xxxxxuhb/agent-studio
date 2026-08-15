import { del, get, post, put } from "../http";
import type {
  AgentChatThread,
  WorkOrder,
  WorkOrderCreate,
} from "@agent-studio/agent-schema";

export const workOrdersApi = {
  list(params: { q?: string; status?: string; team_id?: string }) {
    return get<{ items: WorkOrder[]; total: number }>("/work-orders", { params });
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
  remove(id: string) {
    return del<{ ok: boolean; id: string }>(`/work-orders/${id}`);
  },
  start(
    id: string,
    body: {
      pipeline_id: string;
      executor?: "studio";
      auto_approve?: boolean;
      agents_md_path?: string;
      bridge_base_url?: string;
      preferred_bridge_id?: string;
    },
  ) {
    return post<WorkOrder>(`/work-orders/${id}/start`, body, { timeout: 60_000 });
  },
  restart(
    id: string,
    body: {
      pipeline_id?: string;
      executor?: "studio";
      auto_approve?: boolean;
      agents_md_path?: string;
      bridge_base_url?: string;
      preferred_bridge_id?: string;
      feedback?: string;
      reselect_repos?: boolean;
    } = {},
  ) {
    return post<WorkOrder>(`/work-orders/${id}/restart`, body, { timeout: 60_000 });
  },
  /** Resume failed stage on the same Bridge run. */
  resume(id: string, body: { feedback?: string } = {}) {
    return post<WorkOrder>(`/work-orders/${id}/resume`, body, { timeout: 60_000 });
  },
  cancel(id: string, feedback = "手动结束运行") {
    return post<WorkOrder>(`/work-orders/${id}/cancel`, { feedback });
  },
  runStep(id: string) {
    return post<WorkOrder>(`/work-orders/${id}/run-step`);
  },
  decide(
    id: string,
    decision: "approve" | "reject",
    feedback = "",
    extra?: { action?: string; inputs?: Record<string, unknown> },
  ) {
    return post<WorkOrder>(`/work-orders/${id}/decision`, {
      decision,
      feedback,
      ...extra,
    });
  },
  clarify(id: string, note: string) {
    return post<WorkOrder>(`/work-orders/${id}/clarify`, { note });
  },
  agentChat(id: string) {
    return get<AgentChatThread>(`/work-orders/${id}/agent-chat`);
  },
  postAgentChat(id: string, message: string) {
    return post<{ thread: AgentChatThread; order: WorkOrder }>(
      `/work-orders/${id}/agent-chat`,
      { message },
      { timeout: 600_000 },
    );
  },
  rework(id: string, step_id: string, feedback = "") {
    return post<WorkOrder>(`/work-orders/${id}/rework`, { step_id, feedback });
  },
};
