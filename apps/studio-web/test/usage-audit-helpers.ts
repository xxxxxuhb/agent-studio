/** Shared pure helpers for usage/audit UI tests (and docs). */

export function rollupTokens(input: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}): number | null {
  if (typeof input.total_tokens === "number") return input.total_tokens;
  if (
    typeof input.prompt_tokens === "number" ||
    typeof input.completion_tokens === "number"
  ) {
    return (input.prompt_tokens || 0) + (input.completion_tokens || 0);
  }
  return null;
}

export function settingsAuditAction(keys: string[]): string {
  const secretKeys = keys.filter((k) =>
    /secret|ssh_key|password|token|api_key/i.test(k),
  );
  return secretKeys.length ? "settings.secrets_update" : "settings.update";
}
