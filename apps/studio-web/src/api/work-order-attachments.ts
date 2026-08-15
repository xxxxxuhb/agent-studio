import { del, get, http } from "../http";
import type {
  WorkOrderAttachment,
  WorkOrderAttachmentList,
} from "@agent-studio/agent-schema";

export const workOrderAttachmentsApi = {
  list(workOrderId: string) {
    return get<WorkOrderAttachmentList>(
      `/work-orders/${encodeURIComponent(workOrderId)}/attachments`,
    );
  },
  async upload(workOrderId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    const { data } = await http.post<WorkOrderAttachment>(
      `/work-orders/${encodeURIComponent(workOrderId)}/attachments`,
      form,
      {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60_000,
        transformRequest: [
          (body, headers) => {
            // Let the browser set multipart boundary; drop JSON default.
            if (headers && typeof headers === "object") {
              delete (headers as Record<string, unknown>)["Content-Type"];
            }
            return body;
          },
        ],
      },
    );
    return data;
  },
  remove(workOrderId: string, attachmentId: string) {
    return del<{ ok: boolean }>(
      `/work-orders/${encodeURIComponent(workOrderId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  },
  downloadUrl(workOrderId: string, attachmentId: string) {
    return `/api/work-orders/${encodeURIComponent(workOrderId)}/attachments/${encodeURIComponent(attachmentId)}`;
  },
};
