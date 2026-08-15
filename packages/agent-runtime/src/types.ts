/**
 * Pluggable agent execution surface for Agent Studio Bridge.
 * Bridge orchestrates stages; drivers own how an LLM/agent actually runs.
 */

import type { AgentUsageMetrics } from "./usage.js";

export type { AgentUsageMetrics } from "./usage.js";

export type AgentDriverId =
  | "auto"
  | "cursor"
  | "openai"
  | "trae"
  | "qoder"
  | "custom";

export type AgentRunRequest = {
  /** Pipeline stage / role name (requirement, plan, dev, …) */
  stage: string;
  /** Working directory for local agents */
  cwd: string;
  /** Fully rendered prompt for this stage */
  prompt: string;
  /** Optional opaque metadata (run id, agent id, …) */
  meta?: Record<string, unknown>;
};

export type AgentRunResult = {
  summary: string;
  raw: string;
  /** Driver that produced the result */
  driver: string;
  /** True when no real model was invoked */
  dryRun?: boolean;
  /** Provider-specific run / agent id when available */
  providerRunId?: string;
  /** Token/cost when the driver can report it (Cursor / Qoder today). */
  usage?: AgentUsageMetrics;
};

export interface AgentDriver {
  readonly id: string;
  /** Human-readable name for health / logs */
  readonly label: string;
  /** Whether this driver can run under current env */
  isAvailable(): boolean;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
