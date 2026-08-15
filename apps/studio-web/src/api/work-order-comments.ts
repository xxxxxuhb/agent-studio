import type { WorkOrder, WorkOrderCommentThread } from "@agent-studio/agent-schema";
import { get, post } from "../http";

export const workOrderCommentsApi = {
  list(workOrderId: string) {
    return get<WorkOrderCommentThread>(`/work-orders/${workOrderId}/comments`);
  },
  post(workOrderId: string, body: string) {
    return post<{ thread: WorkOrderCommentThread; order: WorkOrder }>(
      `/work-orders/${workOrderId}/comments`,
      { body },
    );
  },
};
