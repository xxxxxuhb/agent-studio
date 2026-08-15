import type {
  SystemNotificationList,
  SystemNotificationMarkRead,
} from "@agent-studio/agent-schema";
import { get, post } from "../http";

export const notificationsApi = {
  list(teamId: string, opts?: { unread_only?: boolean; limit?: number }) {
    const q = new URLSearchParams({ team_id: teamId });
    if (opts?.unread_only) q.set("unread_only", "1");
    if (opts?.limit) q.set("limit", String(opts.limit));
    return get<SystemNotificationList>(`/notifications?${q}`);
  },
  markRead(teamId: string, body: SystemNotificationMarkRead) {
    return post<SystemNotificationList>(
      `/notifications/read?team_id=${encodeURIComponent(teamId)}`,
      body,
    );
  },
  markAllRead(teamId: string) {
    return post<SystemNotificationList>(
      `/notifications/read-all?team_id=${encodeURIComponent(teamId)}`,
    );
  },
};
