import { z } from "zod";

export const RunLogSourceSchema = z.enum([
  "system",
  "pipeline",
  "agent",
  "bridge",
  "dify",
  "manager",
  "human",
]);
export type RunLogSource = z.infer<typeof RunLogSourceSchema>;

export const RunLogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type RunLogLevel = z.infer<typeof RunLogLevelSchema>;

/** One log line belonging to a work-order run. */
export const RunLogEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  run_id: z.string(),
  work_order_id: z.string(),
  source: RunLogSourceSchema,
  level: RunLogLevelSchema.default("info"),
  message: z.string(),
  /** Longer payload (agent output, Dify form, Bridge summary, …) */
  body: z.string().optional().default(""),
  step_id: z.string().optional(),
  agent: z.string().optional(),
  bridge_stage: z.string().optional(),
  /** Optional correlation with WorkOrderRunEvent.type */
  event_type: z.string().optional(),
  detail: z.record(z.unknown()).optional(),
});
export type RunLogEntry = z.infer<typeof RunLogEntrySchema>;

export const RunLogAppendSchema = RunLogEntrySchema.omit({
  id: true,
  at: true,
}).extend({
  id: z.string().optional(),
  at: z.string().optional(),
});
export type RunLogAppend = z.infer<typeof RunLogAppendSchema>;

export const RunLogMetaSchema = z.object({
  run_id: z.string(),
  work_order_id: z.string(),
  title: z.string().optional().default(""),
  pipeline_id: z.string().optional().default(""),
  pipeline_name: z.string().optional().default(""),
  executor: z.string().optional().default(""),
  project_id: z.string().optional().default(""),
  work_order_status: z.string().optional().default(""),
  started_at: z.string(),
  updated_at: z.string(),
  entry_count: z.number().int().nonnegative().default(0),
  sources: z.array(RunLogSourceSchema).default([]),
});
export type RunLogMeta = z.infer<typeof RunLogMetaSchema>;
