import { describe, expect, it } from "vitest";
import { settingsAuditAction, rollupTokens } from "./usage-audit-helpers";

describe("usage-audit helpers", () => {
  it("rollups tokens", () => {
    expect(rollupTokens({ total_tokens: 3 })).toBe(3);
    expect(rollupTokens({ prompt_tokens: 2, completion_tokens: 4 })).toBe(6);
    expect(rollupTokens({})).toBeNull();
  });

  it("picks settings audit action", () => {
    expect(settingsAuditAction(["git_ssh_key_path"])).toBe(
      "settings.secrets_update",
    );
    expect(settingsAuditAction(["language"])).toBe("settings.update");
  });
});
