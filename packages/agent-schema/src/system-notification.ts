import { z } from "zod";

export const SystemNotificationKindSchema = z.enum([
  "comment_mention",
  "pending_approval",
  "failed",
  "completed",
  "info",
]);
export type SystemNotificationKind = z.infer<
  typeof SystemNotificationKindSchema
>;

export const SystemNotificationSchema = z.object({
  id: z.string().min(1),
  team_id: z.string().min(1),
  user_id: z.string().min(1),
  kind: SystemNotificationKindSchema,
  title: z.string(),
  body: z.string().default(""),
  work_order_id: z.string().optional().default(""),
  actor_user_id: z.string().optional().default(""),
  actor_name: z.string().optional().default(""),
  read_at: z.string().nullable().optional().default(null),
  created_at: z.string(),
});
export type SystemNotification = z.infer<typeof SystemNotificationSchema>;

export const SystemNotificationListSchema = z.object({
  items: z.array(SystemNotificationSchema),
  unread_count: z.number().int().nonnegative(),
});
export type SystemNotificationList = z.infer<
  typeof SystemNotificationListSchema
>;

export const SystemNotificationMarkReadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});
export type SystemNotificationMarkRead = z.infer<
  typeof SystemNotificationMarkReadSchema
>;
