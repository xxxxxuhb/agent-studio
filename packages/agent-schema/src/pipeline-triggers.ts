import { z } from "zod";

export const PipelineTriggerKindSchema = z.enum(["cron", "forge_webhook"]);
export type PipelineTriggerKind = z.infer<typeof PipelineTriggerKindSchema>;

export const ForgeWebhookEventSchema = z.enum(["mr_merged", "issue_labeled"]);
export type ForgeWebhookEvent = z.infer<typeof ForgeWebhookEventSchema>;

const TriggerBase = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, "trigger id must be kebab/snake case"),
  enabled: z.boolean().default(true),
  project_id: z.string().optional().default(""),
  auto_approve: z.boolean().optional().default(false),
  title_template: z.string().optional().default(""),
  requirement_template: z.string().optional().default(""),
});

/** 5-field cron: minute hour day-of-month month day-of-week (0=Sun). */
export const PipelineCronTriggerSchema = TriggerBase.extend({
  kind: z.literal("cron"),
  cron: z.string().min(1),
  /** ISO timestamp of last successful fire (idempotency). */
  last_fired_at: z.string().optional().default(""),
});
export type PipelineCronTrigger = z.infer<typeof PipelineCronTriggerSchema>;

export const PipelineForgeWebhookTriggerSchema = TriggerBase.extend({
  kind: z.literal("forge_webhook"),
  forge: z.enum(["gitlab", "github", "any"]).default("any"),
  events: z.array(ForgeWebhookEventSchema).min(1),
  /** For issue_labeled: match any of these labels (empty = any label). */
  labels: z.array(z.string()).optional().default([]),
  action: z
    .enum(["create_and_start", "advance"])
    .default("create_and_start"),
  /**
   * Optional per-trigger secret. Empty → team `forge_webhook_secret`.
   * GitLab: compared to X-Gitlab-Token; Studio: X-Studio-Webhook-Token.
   */
  secret: z.string().optional().default(""),
});
export type PipelineForgeWebhookTrigger = z.infer<
  typeof PipelineForgeWebhookTriggerSchema
>;

export const PipelineTriggerSchema = z.discriminatedUnion("kind", [
  PipelineCronTriggerSchema,
  PipelineForgeWebhookTriggerSchema,
]);
export type PipelineTrigger = z.infer<typeof PipelineTriggerSchema>;

export type CronParts = {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
};

export function parseCronExpression(expr: string): CronParts | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  return {
    minute: parts[0]!,
    hour: parts[1]!,
    dayOfMonth: parts[2]!,
    month: parts[3]!,
    dayOfWeek: parts[4]!,
  };
}

function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const n = Number(field.slice(2));
    return Number.isFinite(n) && n > 0 && value % n === 0;
  }
  const allowed = field.split(",").map((s) => Number(s.trim()));
  return allowed.some((n) => n === value);
}

/** True when `date` matches a 5-field cron (second ignored; use minute granularity). */
export function cronMatches(expr: string, date: Date = new Date()): boolean {
  const parts = parseCronExpression(expr);
  if (!parts) return false;
  return (
    fieldMatches(parts.minute, date.getMinutes()) &&
    fieldMatches(parts.hour, date.getHours()) &&
    fieldMatches(parts.dayOfMonth, date.getDate()) &&
    fieldMatches(parts.month, date.getMonth() + 1) &&
    fieldMatches(parts.dayOfWeek, date.getDay())
  );
}

export function renderTriggerTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return (template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}
