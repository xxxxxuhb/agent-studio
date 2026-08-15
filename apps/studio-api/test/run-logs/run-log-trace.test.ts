import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunLogEntry } from "@agent-studio/agent-schema";
import {
  buildRunLogTrace,
  looksLikeCorrelationId,
} from "../../dist/run-logs/run-log-trace.js";

function entry(
  partial: Partial<RunLogEntry> & Pick<RunLogEntry, "id" | "at" | "message">,
): RunLogEntry {
  return {
    run_id: "r1",
    work_order_id: "wo-1",
    source: "pipeline",
    level: "info",
    body: "",
    ...partial,
  };
}

describe("looksLikeCorrelationId", () => {
  it("accepts compact ids and rejects free text", () => {
    assert.equal(looksLikeCorrelationId("c2978bd5"), true);
    assert.equal(looksLikeCorrelationId("wo-demo"), true);
    assert.equal(
      looksLikeCorrelationId("abcdef01-2345-6789-abcd-ef0123456789"),
      true,
    );
    assert.equal(looksLikeCorrelationId("bridge fail 503"), false);
    assert.equal(looksLikeCorrelationId("a"), false);
  });
});

describe("buildRunLogTrace", () => {
  it("builds ordered stage + key event timeline", () => {
    const steps = buildRunLogTrace([
      entry({
        id: "1",
        at: "2026-01-01T00:00:00.000Z",
        event_type: "run_started",
        message: "启动流水线 demo",
      }),
      entry({
        id: "2",
        at: "2026-01-01T00:00:01.000Z",
        event_type: "human_input_required",
        message: "等待人工确认",
        source: "human",
      }),
      entry({
        id: "3",
        at: "2026-01-01T00:00:02.000Z",
        event_type: "bridge_stage",
        bridge_stage: "implement",
        message: "bridge implement",
        source: "bridge",
      }),
      entry({
        id: "4",
        at: "2026-01-01T00:00:03.000Z",
        event_type: "bridge_stage",
        bridge_stage: "implement",
        message: "bridge implement again",
        source: "bridge",
      }),
      entry({
        id: "5",
        at: "2026-01-01T00:00:04.000Z",
        event_type: "bridge_stage",
        bridge_stage: "review",
        message: "bridge review",
        source: "bridge",
      }),
      entry({
        id: "6",
        at: "2026-01-01T00:00:05.000Z",
        level: "error",
        message: "Studio failed: bridge_busy",
        source: "system",
      }),
    ]);

    assert.equal(steps.length, 5);
    assert.equal(steps[0].kind, "run_started");
    assert.equal(steps[1].kind, "human_input_required");
    assert.equal(steps[2].kind, "bridge_stage");
    assert.equal(steps[2].label, "implement");
    assert.equal(steps[3].kind, "bridge_stage");
    assert.equal(steps[3].label, "review");
    assert.equal(steps[4].kind, "error");
  });
});
