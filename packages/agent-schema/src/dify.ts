import { z } from "zod";

/**
 * Legacy pipeline ↔ Dify Workflow App binding (MySQL JSON compat).
 * Studio orchestrator ignores these fields.
 */
export const PipelineDifyBindingSchema = z.object({
  enabled: z.boolean().default(false),
  api_base: z.string().optional().default(""),
  api_key: z.string().optional().default(""),
  app_id: z.string().optional().default(""),
  workflow_id: z.string().optional().default(""),
  note: z.string().optional().default(""),
});
export type PipelineDifyBinding = z.infer<typeof PipelineDifyBindingSchema>;

export const PipelineDifyBindingPublicSchema = PipelineDifyBindingSchema.extend({
  api_key_set: z.boolean().default(false),
}).omit({ api_key: true });
export type PipelineDifyBindingPublic = z.infer<
  typeof PipelineDifyBindingPublicSchema
>;

/**
 * Optional Bridge stage override stored historically as `dify.agent_id`.
 */
export const DigitalHumanDifyBindingSchema = z.object({
  agent_id: z.string().optional().default(""),
  agent_name: z.string().optional().default(""),
  note: z.string().optional().default(""),
});
export type DigitalHumanDifyBinding = z.infer<
  typeof DigitalHumanDifyBindingSchema
>;
