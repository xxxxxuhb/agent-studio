import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Pure helpers mirroring UsageService token rollup / Audit action naming. */

function rollupTokens(input: {
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

function settingsAuditAction(keys: string[]): string {
  const secretKeys = keys.filter((k) =>
    /secret|ssh_key|password|token|api_key/i.test(k),
  );
  return secretKeys.length ? "settings.secrets_update" : "settings.update";
}

describe("usage token rollup", () => {
  it("prefers total_tokens", () => {
    assert.equal(
      rollupTokens({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 9 }),
      9,
    );
  });

  it("sums prompt+completion when total missing", () => {
    assert.equal(
      rollupTokens({ prompt_tokens: 10, completion_tokens: 5 }),
      15,
    );
  });

  it("returns null when nothing reported", () => {
    assert.equal(rollupTokens({}), null);
  });
});

describe("settings audit action", () => {
  it("flags secret field updates", () => {
    assert.equal(
      settingsAuditAction(["git_ssh_key_path", "language"]),
      "settings.secrets_update",
    );
  });

  it("uses plain update for non-secret keys", () => {
    assert.equal(settingsAuditAction(["language", "bridge_base_url"]), "settings.update");
  });
});
