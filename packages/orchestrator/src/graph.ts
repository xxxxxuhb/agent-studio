import {
  PIPELINE_GRAPH_END,
  PIPELINE_GRAPH_START,
  normalizePipelineGraph,
  resolveApproveEdge,
  resolveNextEdge,
  resolveRejectEdge,
  type PipelineConditionContext,
  type PipelineEdge,
  type PipelineStepParallel,
} from "@agent-studio/agent-schema";
import type { OrchestratorStep } from "./types";

export type WorkflowGraph = {
  entry: string;
  edges: PipelineEdge[];
};

export type AdvanceContext = PipelineConditionContext;

export type AdvanceTarget =
  | { kind: "end" }
  | { kind: "single"; step_index: number }
  | {
      kind: "parallel";
      branch_indices: number[];
      join: "all" | "any";
      then_index: number; // -1 = end
    };

export function workflowGraphFromSteps(
  steps: OrchestratorStep[],
  opts?: { entry?: string; edges?: PipelineEdge[] },
): WorkflowGraph {
  return normalizePipelineGraph({
    steps: steps.map((s) => ({
      id: s.step_id,
      on_reject: s.on_reject,
      reject_goto: s.reject_goto,
      branches: s.branches,
      parallel: s.parallel,
      human_approval: s.human_approval,
    })),
    entry: opts?.entry,
    edges: opts?.edges,
  });
}

export function entryStepIndex(
  steps: OrchestratorStep[],
  graph: WorkflowGraph,
): number {
  if (!steps.length) return 0;
  const startEdge = resolveNextEdge(graph.edges, PIPELINE_GRAPH_START);
  const entryId = (startEdge?.to || graph.entry || steps[0]!.step_id).trim();
  const idx = steps.findIndex((s) => s.step_id === entryId);
  return idx >= 0 ? idx : 0;
}

function parallelOf(step: OrchestratorStep): PipelineStepParallel | null {
  const p = step.parallel;
  if (!p?.branches || p.branches.length < 2) return null;
  return p;
}

/**
 * Resolve where to go after approving / auto-continuing `fromIndex`.
 * Parallel fan-out takes precedence over cond/next when configured.
 */
export function resolveAdvance(
  steps: OrchestratorStep[],
  graph: WorkflowGraph,
  fromIndex: number,
  ctx: AdvanceContext = {},
): AdvanceTarget {
  const step = steps[fromIndex];
  if (!step) return { kind: "end" };

  const parallel = parallelOf(step);
  if (parallel) {
    const branch_indices: number[] = [];
    for (const id of parallel.branches) {
      const idx = steps.findIndex((s) => s.step_id === id);
      if (idx < 0) return { kind: "end" };
      branch_indices.push(idx);
    }
    const thenId = (parallel.then || "").trim();
    let then_index = -1;
    if (thenId && thenId !== PIPELINE_GRAPH_END) {
      then_index = steps.findIndex((s) => s.step_id === thenId);
      if (then_index < 0) return { kind: "end" };
    }
    return {
      kind: "parallel",
      branch_indices,
      join: parallel.join || "all",
      then_index,
    };
  }

  const edge = resolveApproveEdge(graph.edges, step.step_id, ctx);
  if (!edge) {
    const next = fromIndex + 1;
    if (next < steps.length) return { kind: "single", step_index: next };
    return { kind: "end" };
  }
  if (edge.to === PIPELINE_GRAPH_END) return { kind: "end" };
  const idx = steps.findIndex((s) => s.step_id === edge.to);
  if (idx < 0) return { kind: "end" };
  return { kind: "single", step_index: idx };
}

/**
 * Next step index after approving `fromIndex`, or -1 if the run completes.
 * Cond edges are tried in order; first match wins, then `next`.
 * If the step has parallel fan-out, returns the first branch index (prefer resolveAdvance).
 */
export function nextStepIndexAfterApprove(
  steps: OrchestratorStep[],
  graph: WorkflowGraph,
  fromIndex: number,
  ctx: AdvanceContext = {},
): number {
  const target = resolveAdvance(steps, graph, fromIndex, ctx);
  if (target.kind === "end") return -1;
  if (target.kind === "single") return target.step_index;
  return target.branch_indices[0] ?? -1;
}

export type RejectRoute =
  | { kind: "end" }
  | { kind: "retry" }
  | { kind: "goto"; step_index: number };

export function resolveRejectRoute(
  steps: OrchestratorStep[],
  graph: WorkflowGraph,
  stepIndex: number,
): RejectRoute {
  const step = steps[stepIndex];
  if (!step) return { kind: "end" };

  const edge = resolveRejectEdge(graph.edges, step.step_id);
  if (edge) {
    if (edge.to === PIPELINE_GRAPH_END) return { kind: "end" };
    if (edge.to === step.step_id) return { kind: "retry" };
    const idx = steps.findIndex((s) => s.step_id === edge.to);
    if (idx >= 0) return { kind: "goto", step_index: idx };
    return { kind: "end" };
  }

  // Compat: step fields when no reject edge.
  const onReject = step.on_reject || "end";
  if (onReject === "retry_step") return { kind: "retry" };
  if (onReject === "goto" && step.reject_goto) {
    const idx = steps.findIndex((s) => s.step_id === step.reject_goto);
    if (idx >= 0) return { kind: "goto", step_index: idx };
  }
  return { kind: "end" };
}
