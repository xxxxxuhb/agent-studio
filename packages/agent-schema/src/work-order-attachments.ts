import { z } from "zod";

export const WorkOrderAttachmentSchema = z.object({
  id: z.string().min(1),
  team_id: z.string().min(1),
  work_order_id: z.string().min(1),
  filename: z.string().min(1),
  content_type: z.string().default("application/octet-stream"),
  bytes: z.number().int().nonnegative(),
  created_by: z.string().optional().default(""),
  created_at: z.string(),
});
export type WorkOrderAttachment = z.infer<typeof WorkOrderAttachmentSchema>;

export const WorkOrderAttachmentListSchema = z.object({
  items: z.array(WorkOrderAttachmentSchema),
  total_bytes: z.number().int().nonnegative(),
});
export type WorkOrderAttachmentList = z.infer<
  typeof WorkOrderAttachmentListSchema
>;

/** Max single file size (bytes). */
export const WORK_ORDER_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
/** Max total attachments per work order. */
export const WORK_ORDER_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const WORK_ORDER_ATTACHMENT_MAX_COUNT = 20;

const ALLOWED_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".txt",
  ".md",
  ".log",
  ".json",
  ".csv",
  ".yaml",
  ".yml",
]);

const ALLOWED_MIME_PREFIXES = ["image/", "text/"];
const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "application/json",
  "application/x-yaml",
  "application/yaml",
  "application/octet-stream",
]);

export function isAllowedAttachmentContentType(
  contentType: string,
  filename: string,
): boolean {
  const ct = (contentType || "").trim().toLowerCase();
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  if (ext && ALLOWED_EXT.has(ext)) return true;
  if (!ct) return false;
  if (ALLOWED_MIME_EXACT.has(ct)) return true;
  return ALLOWED_MIME_PREFIXES.some((p) => ct.startsWith(p));
}

/** Basename-only, filesystem-safe name (keeps extension). */
export function sanitizeAttachmentFilename(name: string): string {
  const base = String(name || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .pop() || "file";
  const cleaned = base
    .replace(/[^\w.\u4e00-\u9fff@+-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);
  return cleaned || "file";
}
