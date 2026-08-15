import { z } from "zod";

/**
 * Optional Bridge stage override for a digital human.
 * When `stage_id` is set, orchestrator maps the step to that Bridge stage
 * instead of the default role/id map.
 */
export const DigitalHumanBridgeBindingSchema = z.object({
  stage_id: z.string().optional().default(""),
  stage_name: z.string().optional().default(""),
  note: z.string().optional().default(""),
});
export type DigitalHumanBridgeBinding = z.infer<
  typeof DigitalHumanBridgeBindingSchema
>;

/** Normalize legacy MySQL `dify.{agent_id,agent_name,note}` into bridge binding. */
export function bridgeBindingFromLegacy(
  raw: unknown,
): DigitalHumanBridgeBinding {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DigitalHumanBridgeBindingSchema.parse({});
  }
  const o = raw as Record<string, unknown>;
  return DigitalHumanBridgeBindingSchema.parse({
    stage_id: String(o.stage_id ?? o.agent_id ?? "").trim(),
    stage_name: String(o.stage_name ?? o.agent_name ?? "").trim(),
    note: String(o.note ?? "").trim(),
  });
}
