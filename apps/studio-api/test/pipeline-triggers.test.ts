import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cronMatches, parseCronExpression } from "@agent-studio/agent-schema";
import { normalizeForgePayload } from "../dist/triggers/pipeline-triggers.service";

describe("cronMatches", () => {
  it("parses five fields", () => {
    assert.ok(parseCronExpression("*/5 * * * *"));
    assert.equal(parseCronExpression("bad"), null);
  });

  it("matches every-minute star", () => {
    const d = new Date("2026-08-13T09:07:00");
    assert.equal(cronMatches("* * * * *", d), true);
  });

  it("matches weekday morning", () => {
    // Thursday Aug 13 2026
    const d = new Date(2026, 7, 13, 9, 0, 0);
    assert.equal(cronMatches("0 9 * * 4", d), true);
    assert.equal(cronMatches("0 9 * * 1", d), false);
  });
});

describe("normalizeForgePayload", () => {
  it("detects GitLab MR merge", () => {
    const ev = normalizeForgePayload(
      { "x-gitlab-event": "Merge Request Hook" },
      {
        object_kind: "merge_request",
        object_attributes: {
          action: "merge",
          title: "Fix login",
          description: "body",
          url: "https://gitlab.example.com/a/b/-/merge_requests/1",
        },
        project: { path_with_namespace: "a/b" },
      },
    );
    assert.ok(ev);
    assert.equal(ev!.event, "mr_merged");
    assert.equal(ev!.forge, "gitlab");
  });

  it("detects GitHub PR merged", () => {
    const ev = normalizeForgePayload(
      { "x-github-event": "pull_request" },
      {
        action: "closed",
        pull_request: {
          merged: true,
          title: "Feat",
          body: "x",
          html_url: "https://github.com/o/r/pull/2",
        },
        repository: { full_name: "o/r" },
      },
    );
    assert.ok(ev);
    assert.equal(ev!.event, "mr_merged");
    assert.equal(ev!.forge, "github");
  });
});
