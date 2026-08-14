import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyStudioDecision,
  applyStudioEvent,
  resumeStudioRun,
  startStudioRun,
} from "./runner";
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
  it("reject retry_step re-runs the same stage", async () => {
    const bridge = mockBridge();
    const retrySteps = [
      {
        step_id: "dev",
        agent: "fullstack_dev",
        label: "开发",
        human_approval: true,
        on_reject: "retry_step" as const,
      },
    ];
    const started = await startStudioRun({
      bridge,
      steps: retrySteps,
      agents,
      agents_md_path: "/tmp/AGENTS.md",
      raw_requirement: "do it",
      bridge_base_url: "http://127.0.0.1:8787",
    });
    assert.equal(started.kind, "pending_approval");
    if (started.kind !== "pending_approval") return;

    const next = await applyStudioDecision({
      bridge,
      steps: retrySteps,
      agents,
      state: started.state,
      current_step_index: 0,
      decision: "reject",
      feedback: "fix and retry",
    });
    assert.equal(next.kind, "pending_approval");
    if (next.kind !== "pending_approval") return;
    assert.equal(next.step_index, 0);
    assert.deepEqual(
      bridge.calls.filter((c) => c.startsWith("stage:")),
      ["stage:dev", "stage:dev"],
    );
  });

  it("reject goto jumps to target step", async () => {
    const bridge = mockBridge();
    const gotoSteps = [
      {
        step_id: "dev",
        agent: "fullstack_dev",
        label: "开发",
        human_approval: true,
        on_reject: "end" as const,
      },
      {
        step_id: "review",
        agent: "code_review",
        label: "评审",
        human_approval: true,
        on_reject: "goto" as const,
        reject_goto: "dev",
      },
    ];
    const started = await startStudioRun({
      bridge,
      steps: gotoSteps,
      agents,
      agents_md_path: "/tmp/AGENTS.md",
      raw_requirement: "do it",
      bridge_base_url: "http://127.0.0.1:8787",
    });
    assert.equal(started.kind, "pending_approval");
    if (started.kind !== "pending_approval") return;

    const afterDev = await applyStudioDecision({
      bridge,
      steps: gotoSteps,
      agents,
      state: started.state,
      current_step_index: 0,
      decision: "approve",
    });
    assert.equal(afterDev.kind, "pending_approval");
    if (afterDev.kind !== "pending_approval") return;
    assert.equal(afterDev.step_index, 1);

    const afterReject = await applyStudioDecision({
      bridge,
      steps: gotoSteps,
      agents,
      state: afterDev.state,
      current_step_index: 1,
      decision: "reject",
      feedback: "needs more work",
    });
    assert.equal(afterReject.kind, "pending_approval");
    if (afterReject.kind !== "pending_approval") return;
    assert.equal(afterReject.step_index, 0);
    assert.ok(bridge.calls.filter((c) => c === "stage:dev").length >= 2);
  });

  it("approve follows explicit next edge (skip middle step)", async () => {
    const bridge = mockBridge();
    const skipSteps = [
      {
        step_id: "dev",
        agent: "fullstack_dev",
        human_approval: true,
        on_reject: "end" as const,
      },
      {
        step_id: "review",
        agent: "code_review",
        human_approval: true,
        on_reject: "end" as const,
      },
      {
        step_id: "test",
        agent: "test",
        human_approval: false,
        on_reject: "end" as const,
      },
    ];
    const edges = [
      {
        id: "e_start",
        from: "__start__",
        to: "dev",
        kind: "next" as const,
      },
      {
        id: "e_dev_test",
        from: "dev",
        to: "test",
        kind: "next" as const,
      },
      {
        id: "e_test_end",
        from: "test",
        to: "__end__",
        kind: "next" as const,
      },
      {
        id: "e_dev_rej",
        from: "dev",
        to: "__end__",
        kind: "reject" as const,
      },
      {
        id: "e_test_rej",
        from: "test",
        to: "__end__",
        kind: "reject" as const,
      },
    ];
    const started = await startStudioRun({
      bridge,
      steps: skipSteps,
      agents,
      agents_md_path: "/tmp/AGENTS.md",
      raw_requirement: "do it",
      bridge_base_url: "http://127.0.0.1:8787",
      edges,
      entry: "dev",
    });
    assert.equal(started.kind, "pending_approval");
    if (started.kind !== "pending_approval") return;

    const next = await applyStudioDecision({
      bridge,
      steps: skipSteps,
      agents,
      state: started.state,
      current_step_index: 0,
      decision: "approve",
      edges,
      entry: "dev",
    });
    assert.equal(next.kind, "completed");
    assert.ok(bridge.calls.includes("stage:test"));
    assert.ok(!bridge.calls.includes("stage:review"));
  });
  it("approve follows cond edge when feedback matches", async () => {
    const bridge = mockBridge();
    const branched = [
      {
        step_id: "review",
        agent: "code_review",
        human_approval: true,
        on_reject: "end" as const,
        branches: [
          {
            to: "hotfix",
            when: { op: "feedback_includes" as const, value: "hotfix" },
          },
        ],
      },
      {
        step_id: "test",
        agent: "test",
        human_approval: false,
        on_reject: "end" as const,
      },
      {
        step_id: "hotfix",
        agent: "fullstack_dev",
        human_approval: false,
        on_reject: "end" as const,
      },
    ];
    const started = await startStudioRun({
      bridge,
      steps: branched,
      agents,
      agents_md_path: "/tmp/AGENTS.md",
      raw_requirement: "do it",
      bridge_base_url: "http://127.0.0.1:8787",
    });
    assert.equal(started.kind, "pending_approval");
    if (started.kind !== "pending_approval") return;

    const next = await applyStudioDecision({
      bridge,
      steps: branched,
      agents,
      state: started.state,
      current_step_index: 0,
      decision: "approve",
      feedback: "ship hotfix now",
    });
    assert.equal(next.kind, "completed");
    assert.ok(bridge.calls.includes("stage:dev")); // hotfix agent maps to dev
    assert.ok(!bridge.calls.includes("stage:test"));
  });

  it("approve fans out parallel branches then joins", async () => {
    const bridge = mockBridge();
    const steps = [
      {
        step_id: "dev",
        agent: "fullstack_dev",
        human_approval: true,
        on_reject: "end" as const,
        parallel: {
          branches: ["review", "test"],
          join: "all" as const,
          then: "release",
        },
      },
      {
        step_id: "review",
        agent: "code_review",
        human_approval: false,
        on_reject: "end" as const,
      },
      {
        step_id: "test",
        agent: "test",
        human_approval: false,
        on_reject: "end" as const,
      },
      {
        step_id: "release",
        agent: "release_test",
        human_approval: false,
        on_reject: "end" as const,
      },
    ];
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
    });
    assert.equal(next.kind, "completed");
    assert.ok(bridge.calls.includes("stage:review"));
    assert.ok(bridge.calls.includes("stage:test"));
    assert.ok(bridge.calls.includes("stage:release_test"));
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

describe("non-agent steps", () => {
  it("pauses on wait_event then continues via applyStudioEvent", async () => {
    const bridge = mockBridge();
    const waitSteps = [
      {
        step_id: "wait_mr",
        agent: "",
        kind: "wait_event" as const,
        wait_event: { event: "mr_merged" as const, labels: [] },
        human_approval: false,
        on_reject: "end" as const,
      },
      {
        step_id: "dev",
        agent: "fullstack_dev",
        human_approval: false,
        on_reject: "end" as const,
      },
    ];
    const out = await startStudioRun({
      bridge,
      steps: waitSteps,
      agents,
      agents_md_path: "/tmp/AGENTS.md",
      raw_requirement: "ship it",
      bridge_base_url: "http://127.0.0.1:8787",
      auto_approve: true,
    });
    assert.equal(out.kind, "waiting_event");
    if (out.kind !== "waiting_event") return;
    assert.equal(out.event, "mr_merged");
    assert.equal(out.state.status, "waiting");
    assert.deepEqual(bridge.calls, ["createRun"]);

    const next = await applyStudioEvent({
      bridge,
      steps: waitSteps,
      agents,
      state: out.state,
      current_step_index: out.step_index,
      event: "mr_merged",
      auto_approve: true,
      raw_requirement: "ship it",
    });
    assert.equal(next.kind, "completed");
    assert.ok(bridge.calls.includes("stage:dev"));
  });

  it("runs http step without executeStage", async () => {
    const bridge = mockBridge();
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("pong", { status: 200 })) as typeof fetch;
    try {
      const out = await startStudioRun({
        bridge,
        steps: [
          {
            step_id: "hook",
            agent: "",
            kind: "http",
            http: {
              url: "https://example.test/hook",
              method: "POST",
              headers: {},
              body: '{"id":"{{work_order_id}}"}',
              success_statuses: [200],
              timeout_ms: 5_000,
            },
            human_approval: false,
            on_reject: "end",
          },
        ],
        agents,
        agents_md_path: "/tmp/AGENTS.md",
        raw_requirement: "ping",
        bridge_base_url: "http://127.0.0.1:8787",
        work_order_id: "wo-1",
        auto_approve: true,
      });
      assert.equal(out.kind, "completed");
      assert.deepEqual(bridge.calls, ["createRun"]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
