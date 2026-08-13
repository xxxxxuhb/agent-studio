import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkOrder } from "@agent-studio/agent-schema";
import { forgeCommitUrl } from "@agent-studio/agent-schema";
import {
  applyBridgeGitNote,
  parseBridgeGitNote,
} from "../../dist/work-orders/work-order-bridge-git.js";

describe("forgeCommitUrl", () => {
  it("maps GitLab MR → commit", () => {
    assert.equal(
      forgeCommitUrl(
        "http://localhost:8929/root/demo/-/merge_requests/3",
        "abc1234",
      ),
      "http://localhost:8929/root/demo/-/commit/abc1234",
    );
  });

  it("maps GitHub PR → commit", () => {
    assert.equal(
      forgeCommitUrl("https://github.com/acme/app/pull/12", "deadbeef"),
      "https://github.com/acme/app/commit/deadbeef",
    );
  });
});

describe("parseBridgeGitNote", () => {
  it("returns null without bridge git marker", () => {
    assert.equal(parseBridgeGitNote("committed abcdef0 on studio/dev/x"), null);
  });

  it("parses commit + GitLab MR url", () => {
    const parsed = parseBridgeGitNote(`
[bridge] git: committed abcdef012345 on studio/dev/r1 and pushed
| pr: http://localhost:8929/root/demo/-/merge_requests/3
`);
    assert.ok(parsed);
    assert.equal(parsed.sha, "abcdef012345");
    assert.equal(parsed.branch, "studio/dev/r1");
    assert.equal(parsed.pushed, true);
    assert.equal(
      parsed.prUrl,
      "http://localhost:8929/root/demo/-/merge_requests/3",
    );
  });

  it("parses opened GitLab MR phrasing", () => {
    const parsed = parseBridgeGitNote(
      `[bridge] git: committed deadbeefdeadbeef on studio/dev/r2; opened GitLab MR: http://gl.example/a/b/-/merge_requests/1)`,
    );
    assert.ok(parsed);
    assert.equal(parsed.sha, "deadbeefdeadbeef");
    assert.match(parsed.prUrl, /merge_requests\/1$/);
  });
});

describe("applyBridgeGitNote", () => {
  it("writes run.git and skips unchanged", () => {
    const order = {
      id: "wo-1",
      title: "t",
      requirement: "r",
      status: "running",
      run: {
        run_id: "r1",
        pipeline_id: "p",
        pipeline_name: "p",
        executor: "dify",
        current_step_index: 0,
        steps: [],
        events: [],
        started_at: "2026-01-01T00:00:00.000Z",
      },
    } as unknown as WorkOrder;

    const text =
      "[bridge] git: committed abcdef0123456789 on studio/dev/r1 and pushed | pr: http://localhost:8929/root/demo/-/merge_requests/3";
    assert.equal(
      applyBridgeGitNote(order, text, { stamp: "2026-01-01T01:00:00.000Z" }),
      true,
    );
    assert.equal(order.run?.git?.commit_sha, "abcdef0123456789");
    assert.equal(order.run?.git?.status, "pr_open");
    assert.equal(
      order.run?.git?.commit_url,
      "http://localhost:8929/root/demo/-/commit/abcdef0123456789",
    );
    assert.equal(
      applyBridgeGitNote(order, text, { stamp: "2026-01-01T02:00:00.000Z" }),
      false,
    );
  });
});
