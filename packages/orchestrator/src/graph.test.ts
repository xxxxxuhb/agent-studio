import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  entryStepIndex,
  nextStepIndexAfterApprove,
  resolveAdvance,
  resolveRejectRoute,
  workflowGraphFromSteps,
} from "./graph";
import type { OrchestratorStep } from "./types";

const steps: OrchestratorStep[] = [
  {
    step_id: "dev",
    agent: "fullstack_dev",
    human_approval: true,
    on_reject: "end",
  },
  {
    step_id: "review",
    agent: "code_review",
    human_approval: true,
    on_reject: "goto",
    reject_goto: "dev",
  },
  {
    step_id: "test",
    agent: "test",
    human_approval: false,
    on_reject: "retry_step",
  },
];

describe("workflowGraphFromSteps", () => {
  it("synthesizes linear next + reject edges", () => {
    const graph = workflowGraphFromSteps(steps);
    assert.equal(graph.entry, "dev");
    assert.ok(graph.edges.some((e) => e.from === "__start__" && e.to === "dev"));
    assert.ok(
      graph.edges.some(
        (e) => e.from === "dev" && e.to === "review" && e.kind === "next",
      ),
    );
    assert.ok(
      graph.edges.some(
        (e) => e.from === "review" && e.to === "dev" && e.kind === "reject",
      ),
    );
    assert.ok(
      graph.edges.some(
        (e) => e.from === "test" && e.to === "test" && e.kind === "reject",
      ),
    );
  });

  it("resolves approve / reject routes", () => {
    const graph = workflowGraphFromSteps(steps);
    assert.equal(entryStepIndex(steps, graph), 0);
    assert.equal(nextStepIndexAfterApprove(steps, graph, 0), 1);
    assert.equal(nextStepIndexAfterApprove(steps, graph, 2), -1);
    assert.deepEqual(resolveRejectRoute(steps, graph, 1), {
      kind: "goto",
      step_index: 0,
    });
    assert.deepEqual(resolveRejectRoute(steps, graph, 2), { kind: "retry" });
    assert.deepEqual(resolveRejectRoute(steps, graph, 0), { kind: "end" });
  });

  it("cond edge wins over next when feedback matches", () => {
    const branched: OrchestratorStep[] = [
      {
        step_id: "review",
        agent: "code_review",
        human_approval: true,
        on_reject: "end",
        branches: [
          {
            to: "hotfix",
            label: "紧急",
            when: { op: "feedback_includes", value: "hotfix" },
          },
        ],
      },
      {
        step_id: "test",
        agent: "test",
        human_approval: false,
        on_reject: "end",
      },
      {
        step_id: "hotfix",
        agent: "fullstack_dev",
        human_approval: false,
        on_reject: "end",
      },
    ];
    const graph = workflowGraphFromSteps(branched);
    assert.equal(
      nextStepIndexAfterApprove(branched, graph, 0, { feedback: "please hotfix" }),
      2,
    );
    assert.equal(
      nextStepIndexAfterApprove(branched, graph, 0, { feedback: "lgtm" }),
      1,
    );
  });

  it("parallel fan-out resolves to branches + then", () => {
    const steps: OrchestratorStep[] = [
      {
        step_id: "dev",
        agent: "fullstack_dev",
        human_approval: true,
        on_reject: "end",
        parallel: {
          branches: ["review", "test"],
          join: "all",
          then: "release",
        },
      },
      {
        step_id: "review",
        agent: "code_review",
        human_approval: false,
        on_reject: "end",
      },
      {
        step_id: "test",
        agent: "test",
        human_approval: false,
        on_reject: "end",
      },
      {
        step_id: "release",
        agent: "release_test",
        human_approval: false,
        on_reject: "end",
      },
    ];
    const graph = workflowGraphFromSteps(steps);
    const target = resolveAdvance(steps, graph, 0);
    assert.equal(target.kind, "parallel");
    if (target.kind !== "parallel") return;
    assert.deepEqual(target.branch_indices, [1, 2]);
    assert.equal(target.then_index, 3);
    assert.equal(target.join, "all");
  });
});
