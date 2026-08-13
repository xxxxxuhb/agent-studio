/**
 * E2E golden path: work-order start → human approve → completed + artifacts.
 * Uses createHttpBridgeClient + fetch mock (no real Bridge / Dify).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyStudioDecision, createHttpBridgeClient, startStudioRun } from "./index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetchBridge(): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    calls.push(`${method} ${url.replace(/^https?:\/\/[^/]+/, "")}`);

    if (method === "POST" && /\/runs$/.test(url)) {
      return jsonResponse(200, {
        run: { id: "br-golden-1", status: "running" },
        manager: { summary: "manager ok" },
      });
    }

    if (method === "POST" && /\/runs\/br-golden-1\/dev$/.test(url)) {
      return jsonResponse(200, {
        runId: "br-golden-1",
        stage: "dev",
        status: "ok",
        summary: "dev patch ready",
        artifacts: ["docs/dify-runs/br-golden-1/dev-summary.md"],
        pendingHumanApproval: true,
      });
    }

    if (method === "POST" && /\/runs\/br-golden-1\/decision$/.test(url)) {
      return jsonResponse(200, { id: "br-golden-1", status: "ok" });
    }

    if (method === "POST" && /\/runs\/br-golden-1\/test$/.test(url)) {
      return jsonResponse(200, {
        runId: "br-golden-1",
        stage: "test",
        status: "ok",
        summary: "tests green",
        artifacts: ["docs/dify-runs/br-golden-1/test-report.md"],
        pendingHumanApproval: false,
      });
    }

    return jsonResponse(404, { error: `unexpected ${method} ${url}` });
  };
  return { fetchImpl, calls };
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

describe("E2E golden path (mock Bridge HTTP)", () => {
  it("start → pending approval → approve → completed with artifacts", async () => {
    const { fetchImpl, calls } = mockFetchBridge();
    const bridge = createHttpBridgeClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "dev-bridge-token",
      fetchImpl,
    });
    const seenArtifacts: string[] = [];

    const started = await startStudioRun({
      bridge,
      steps,
      agents: { get: () => undefined },
      agents_md_path: "/tmp/AGENTS.md",
      raw_requirement: "【工单】golden path\nfix a bug",
      bridge_base_url: "http://127.0.0.1:8787",
      onProgress: (p) => {
        for (const a of p.stage_result?.artifacts || []) {
          seenArtifacts.push(a);
        }
      },
    });

    assert.equal(started.kind, "pending_approval");
    if (started.kind !== "pending_approval") return;
    assert.equal(started.state.bridge_run_id, "br-golden-1");
    assert.equal(started.stage, "dev");
    assert.ok(seenArtifacts.some((a) => a.includes("dev-summary.md")));

    const finished = await applyStudioDecision({
      bridge,
      steps,
      agents: { get: () => undefined },
      state: started.state,
      current_step_index: 0,
      decision: "approve",
      feedback: "lgtm",
      onProgress: (p) => {
        for (const a of p.stage_result?.artifacts || []) {
          seenArtifacts.push(a);
        }
      },
    });

    assert.equal(finished.kind, "completed");
    assert.ok(seenArtifacts.some((a) => a.includes("test-report.md")));
    assert.deepEqual(calls, [
      "POST /runs",
      "POST /runs/br-golden-1/dev",
      "POST /runs/br-golden-1/decision",
      "POST /runs/br-golden-1/test",
    ]);
  });
});
