import { del, get, post, put } from "../http";
import type {
  ManagerChatThread,
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
      executor?: "dify" | "studio";
      auto_approve?: boolean;
      agents_md_path?: string;
      bridge_base_url?: string;
    },
  ) {
    return post<WorkOrder>(`/work-orders/${id}/start`, body, { timeout: 60_000 });
  },
  restart(
    id: string,
    body: {
      pipeline_id?: string;
      executor?: "dify" | "studio";
      auto_approve?: boolean;
      agents_md_path?: string;
      bridge_base_url?: string;
      feedback?: string;
    } = {},
  ) {
    return post<WorkOrder>(`/work-orders/${id}/restart`, body, { timeout: 60_000 });
  },
  syncDify(id: string) {
    return post<WorkOrder>(`/work-orders/${id}/sync-dify`, undefined, {
      timeout: 45_000,
    });
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
  rework(id: string, step_id: string, feedback = "") {
    return post<WorkOrder>(`/work-orders/${id}/rework`, { step_id, feedback });
  },
  getChat(id: string) {
    return get<ManagerChatThread>(`/work-orders/${id}/chat`);
  },
  chat(id: string, messageText: string) {
    return post<{
      reply: string;
      actions: string[];
      work_order: WorkOrder;
      thread: ManagerChatThread;
    }>(`/work-orders/${id}/chat`, { message: messageText });
  },
};
