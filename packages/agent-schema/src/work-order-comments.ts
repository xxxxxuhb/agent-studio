import { z } from "zod";

export const WorkOrderCommentSchema = z.object({
  id: z.string().min(1),
  work_order_id: z.string().min(1),
  author_user_id: z.string().default(""),
  author_name: z.string().default(""),
  body: z.string().min(1),
  mentioned_user_ids: z.array(z.string()).default([]),
  created_at: z.string(),
});
export type WorkOrderComment = z.infer<typeof WorkOrderCommentSchema>;

export const WorkOrderCommentThreadSchema = z.object({
  work_order_id: z.string().min(1),
  comments: z.array(WorkOrderCommentSchema).default([]),
  updated_at: z.string().optional(),
});
export type WorkOrderCommentThread = z.infer<typeof WorkOrderCommentThreadSchema>;

export const WorkOrderCommentPostSchema = z.object({
  body: z.string().min(1).max(8000),
});
export type WorkOrderCommentPost = z.infer<typeof WorkOrderCommentPostSchema>;
