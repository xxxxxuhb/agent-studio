import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyStudioDecision, resumeStudioRun, startStudioRun } from "./runner";
import type { BridgeClient, StageResult } from "./types";

function mockBridge(opts?: {
  stages?: Record<string, StageResult>;
}): BridgeClient & { calls: string[] } {
  const calls: string[] = [];
  const stages = opts?.stages || {};
  return {
    calls,
    async createRun() {
      calls.push("createRun");
      return { run: { id: "br-1" }, manager: { summary: "mgr ok" } };
    },
    async executeStage(runId, stage) {
      calls.push(`stage:${stage}`);
      if (stages[stage]) return { ...stages[stage], runId };
      return {
        runId,
        stage,
        status: "ok",
        summary: `${stage} done`,
        artifacts: [],
        pendingHumanApproval: true,
      };
    },
    async decide(runId, body) {
      calls.push(`decide:${body.decision}`);
      return { id: runId, status: "ok" };
    },
  };
}

const steps = [
  {
    step_id: "dev",
    agent: "fullstack_dev",
    label: "开发",
    human_approval: true,
    on_reject: "end" as const,
  },
  {
    step_id: "test",
    agent: "test",
    label: "测试",
    human_approval: false,
    on_reject: "end" as const,
  },
];

const agents = {
  get: () => undefined,
};

describe("startStudioRun", () => {
  it("pauses on first human_approval step", async () => {
    const bridge = mockBridge();
    const out = await startStudioRun({
      bridge,
      steps,
      agents,
      agents_md_path: "/tmp/AGENTS.md",
      raw_requirement: "do it",
      bridge_base_url: "http://127.0.0.1:8787",
    });
    assert.equal(out.kind, "pending_approval");
    if (out.kind !== "pending_approval") return;
    assert.equal(out.state.bridge_run_id, "br-1");
    assert.equal(out.stage, "dev");
    assert.equal(out.step_index, 0);
    assert.deepEqual(bridge.calls, ["createRun", "stage:dev"]);
  });

  it("auto-approves through to completion", async () => {
    const bridge = mockBridge();
    const out = await startStudioRun({
      bridge,
      steps,
      agents,
      agents_md_path: "/tmp/AGENTS.md",
      raw_requirement: "do it",
      bridge_base_url: "http://127.0.0.1:8787",
      auto_approve: true,
    });
    assert.equal(out.kind, "completed");
    assert.ok(bridge.calls.includes("stage:dev"));
    assert.ok(bridge.calls.includes("decide:approve"));
    assert.ok(bridge.calls.includes("stage:test"));
  });
});

describe("applyStudioDecision", () => {
  it("approve continues to next stage and completes", async () => {
    const bridge = mockBridge();
    const started = await startStudioRun({
      bridge,
      steps,
      agents,
      agents_md_path: "/tmp/AGENTS.md",
      raw_requirement: "do it",
      bridge_base_url: "http://127.0.0.1:8787",
    });
    assert.equal(started.kind, "pending_approval");
    if (started.kind !== "pending_approval") return;

    const next = await applyStudioDecision({
      bridge,
      steps,
      agents,
      state: started.state,
      current_step_index: 0,
      decision: "approve",
      feedback: "lgtm",
    });
    assert.equal(next.kind, "completed");
    assert.ok(bridge.calls.includes("decide:approve"));
    assert.ok(bridge.calls.includes("stage:test"));
  });

  it("reject ends the run", async () => {
    const bridge = mockBridge();
    const started = await startStudioRun({
      bridge,
      steps,
      agents,
      agents_md_path: "/tmp/AGENTS.md",
      raw_requirement: "do it",
      bridge_base_url: "http://127.0.0.1:8787",
    });
    assert.equal(started.kind, "pending_approval");
    if (started.kind !== "pending_approval") return;

    const next = await applyStudioDecision({
      bridge,
      steps,
      agents,
      state: started.state,
      current_step_index: 0,
      decision: "reject",
      feedback: "nope",
    });
    assert.equal(next.kind, "rejected");
  });
});

describe("resumeStudioRun", () => {
  it("re-runs the failed stage without createRun", async () => {
    const bridge = mockBridge();
    const out = await resumeStudioRun({
      bridge,
      steps,
      agents,
      state: {
        bridge_run_id: "br-existing",
        bridge_base_url: "http://127.0.0.1:8787",
        status: "failed",
        error: "previous boom",
        current_stage: "dev",
      },
      current_step_index: 0,
      feedback: "retry tip",
    });
    assert.equal(out.kind, "pending_approval");
    assert.ok(!bridge.calls.includes("createRun"));
    assert.deepEqual(bridge.calls, ["stage:dev"]);
    if (out.kind === "pending_approval") {
      assert.equal(out.state.bridge_run_id, "br-existing");
      assert.equal(out.step_index, 0);
    }
  });

  it("fails clearly when bridge_run_id is missing", async () => {
    const bridge = mockBridge();
    const out = await resumeStudioRun({
      bridge,
      steps,
      agents,
      state: {
        bridge_run_id: "",
        bridge_base_url: "http://127.0.0.1:8787",
        status: "failed",
      },
      current_step_index: 0,
    });
    assert.equal(out.kind, "failed");
    if (out.kind === "failed") {
      assert.match(out.error, /重新执行/);
    }
    assert.deepEqual(bridge.calls, []);
  });
});
