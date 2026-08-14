import { z } from "zod";

export const PipelineStepKindSchema = z.enum([
  "agent",
  "http",
  "wait_event",
  "ci",
  /** Sleep N seconds then continue. */
  "delay",
  /** Auto-pass control node (条件 / 并行挂载点). */
  "gateway",
]);
export type PipelineStepKind = z.infer<typeof PipelineStepKindSchema>;

export const PipelineHttpStepSchema = z.object({
  url: z.string().min(1),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
    .default("POST"),
  headers: z.record(z.string()).optional().default({}),
  /** Request body; supports {{requirement}} {{title}} {{work_order_id}} {{run_id}}. */
  body: z.string().optional().default(""),
  success_statuses: z.array(z.number().int()).optional().default([200, 201, 202, 204]),
  timeout_ms: z.number().int().positive().max(120_000).optional().default(30_000),
});
export type PipelineHttpStep = z.infer<typeof PipelineHttpStepSchema>;

export const PipelineWaitEventStepSchema = z.object({
  event: z.enum(["mr_merged", "issue_labeled", "manual"]),
  /** For issue_labeled: empty = any label. */
  labels: z.array(z.string()).optional().default([]),
});
export type PipelineWaitEventStep = z.infer<typeof PipelineWaitEventStepSchema>;

/**
 * Trigger a CI job via HTTP, optionally poll until success/failure text appears.
 */
export const PipelineCiStepSchema = z.object({
  trigger_url: z.string().min(1),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
    .default("POST"),
  headers: z.record(z.string()).optional().default({}),
  body: z.string().optional().default(""),
  success_statuses: z.array(z.number().int()).optional().default([200, 201, 202, 204]),
  timeout_ms: z.number().int().positive().max(120_000).optional().default(30_000),
  poll_url: z.string().optional().default(""),
  poll_interval_ms: z.number().int().positive().max(60_000).optional().default(5_000),
  poll_timeout_ms: z.number().int().positive().max(3_600_000).optional().default(600_000),
  /** Case-insensitive substring in poll response body → success. */
  success_includes: z.string().optional().default("success"),
  /** Case-insensitive substring → fail the step. */
  failure_includes: z.string().optional().default("failure"),
});
export type PipelineCiStep = z.infer<typeof PipelineCiStepSchema>;

export const PipelineDelayStepSchema = z.object({
  /** Wait duration before continuing (1s–24h). */
  seconds: z.number().int().positive().max(86_400).default(60),
});
export type PipelineDelayStep = z.infer<typeof PipelineDelayStepSchema>;
