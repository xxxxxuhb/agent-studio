/**
 * Shared usage shape for Bridge → Studio (`StageResult.usage` / `usage_events`).
 */
export type AgentUsageMetrics = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** Billed USD when the provider reports it. */
  cost_usd?: number;
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Normalize optional token/cost fields; returns undefined when nothing useful was reported. */
export function buildUsageMetrics(input: {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  cost_usd?: unknown;
}): AgentUsageMetrics | undefined {
  const prompt_tokens = finiteNumber(input.prompt_tokens);
  const completion_tokens = finiteNumber(input.completion_tokens);
  let total_tokens = finiteNumber(input.total_tokens);
  if (
    total_tokens == null &&
    (prompt_tokens != null || completion_tokens != null)
  ) {
    total_tokens = (prompt_tokens || 0) + (completion_tokens || 0);
  }
  const cost_usd = finiteNumber(input.cost_usd);
  if (
    prompt_tokens == null &&
    completion_tokens == null &&
    total_tokens == null &&
    cost_usd == null
  ) {
    return undefined;
  }
  return {
    ...(prompt_tokens != null ? { prompt_tokens } : {}),
    ...(completion_tokens != null ? { completion_tokens } : {}),
    ...(total_tokens != null ? { total_tokens } : {}),
    ...(cost_usd != null ? { cost_usd } : {}),
  };
}

/** Cursor SDK TokenUsage → AgentUsageMetrics. */
export function usageFromCursorTokens(
  usage:
    | {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      }
    | null
    | undefined,
  costCents?: number | null,
): AgentUsageMetrics | undefined {
  return buildUsageMetrics({
    prompt_tokens: usage?.inputTokens,
    completion_tokens: usage?.outputTokens,
    total_tokens: usage?.totalTokens,
    cost_usd:
      typeof costCents === "number" && Number.isFinite(costCents)
        ? costCents / 100
        : undefined,
  });
}

/** Qoder result.usage + total_cost_usd → AgentUsageMetrics. */
export function usageFromQoderResult(input: {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  } | null;
  total_cost_usd?: number | null;
}): AgentUsageMetrics | undefined {
  return buildUsageMetrics({
    prompt_tokens: input.usage?.input_tokens,
    completion_tokens: input.usage?.output_tokens,
    cost_usd: input.total_cost_usd,
  });
}
