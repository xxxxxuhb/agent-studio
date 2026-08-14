import { z } from "zod";

/** Virtual terminals for pipeline graphs (not real agent steps). */
export const PIPELINE_GRAPH_START = "__start__";
export const PIPELINE_GRAPH_END = "__end__";

export const PipelineEdgeKindSchema = z.enum([
  "next",
  "reject",
  "cond",
  "parallel",
]);
export type PipelineEdgeKind = z.infer<typeof PipelineEdgeKindSchema>;

/**
 * After this step completes, run `branches` concurrently, then continue to `then`.
 * Branch steps should not require human approval (auto-run until join).
 */
export const PipelineStepParallelSchema = z.object({
  branches: z.array(z.string().min(1)).min(2),
  join: z.enum(["all", "any"]).default("all"),
  /** Next step after join; empty / omitted → `__end__`. */
  then: z.string().optional().default(""),
});
export type PipelineStepParallel = z.infer<typeof PipelineStepParallelSchema>;

/**
 * Safe condition language for approve-side branching (no arbitrary JS).
 * - default: always true (use as last cond, or omit and fall through to `next`)
 * - *_includes: case-insensitive substring
 * - feedback_matches: RegExp source (invalid → false)
 * - and / or: combine child conditions
 */
export type PipelineCondition =
  | { op: "default" }
  | { op: "feedback_includes"; value: string }
  | { op: "feedback_matches"; value: string }
  | { op: "summary_includes"; value: string }
  | { op: "artifact_includes"; value: string }
  | { op: "and"; all: PipelineCondition[] }
  | { op: "or"; any: PipelineCondition[] };

export const PipelineConditionSchema: z.ZodType<PipelineCondition> = z.lazy(
  () =>
    z.union([
      z.object({ op: z.literal("default") }),
      z.object({
        op: z.literal("feedback_includes"),
        value: z.string().min(1),
      }),
      z.object({
        op: z.literal("feedback_matches"),
        value: z.string().min(1).max(200),
      }),
      z.object({
        op: z.literal("summary_includes"),
        value: z.string().min(1),
      }),
      z.object({
        op: z.literal("artifact_includes"),
        value: z.string().min(1),
      }),
      z.object({
        op: z.literal("and"),
        all: z.array(PipelineConditionSchema).min(1),
      }),
      z.object({
        op: z.literal("or"),
        any: z.array(PipelineConditionSchema).min(1),
      }),
    ]),
);

export const PipelineStepBranchSchema = z.object({
  to: z.string().min(1),
  label: z.string().optional(),
  when: PipelineConditionSchema,
});
export type PipelineStepBranch = z.infer<typeof PipelineStepBranchSchema>;

/**
 * Control-flow edge. `cond` edges are evaluated in order on approve;
 * first match wins, then fall back to `next`.
 */
export const PipelineEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: PipelineEdgeKindSchema.default("next"),
  when: PipelineConditionSchema.optional(),
  label: z.string().optional(),
});
export type PipelineEdge = z.infer<typeof PipelineEdgeSchema>;

export type PipelineGraphInput = {
  steps: Array<{
    id: string;
    on_reject?: "end" | "retry_step" | "goto";
    reject_goto?: string;
    /** Explicit next; null/"" = none; undefined = linear fallback (runtime legacy). */
    next?: string | null;
    branches?: PipelineStepBranch[];
    parallel?: PipelineStepParallel | null;
    human_approval?: boolean;
  }>;
  entry?: string;
  edges?: PipelineEdge[];
};

export type PipelineConditionContext = {
  feedback?: string;
  summary?: string;
  artifacts?: string[];
};

function edgeId(kind: string, from: string, to: string, salt = ""): string {
  const base = `e_${kind}_${from}_to_${to}${salt ? `_${salt}` : ""}`;
  return base.replace(/[^a-zA-Z0-9_]+/g, "_");
}

function includesCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Evaluate a condition against stage / decision context. */
export function evaluatePipelineCondition(
  when: PipelineCondition | unknown | undefined,
  ctx: PipelineConditionContext,
): boolean {
  if (when == null || typeof when !== "object") return false;
  const cond = when as PipelineCondition;
  const feedback = ctx.feedback || "";
  const summary = ctx.summary || "";
  const artifacts = ctx.artifacts || [];

  switch (cond.op) {
    case "default":
      return true;
    case "feedback_includes":
      return Boolean(cond.value) && includesCI(feedback, cond.value);
    case "feedback_matches": {
      if (!cond.value) return false;
      try {
        return new RegExp(cond.value, "i").test(feedback);
      } catch {
        return false;
      }
    }
    case "summary_includes":
      return Boolean(cond.value) && includesCI(summary, cond.value);
    case "artifact_includes":
      return (
        Boolean(cond.value) &&
        artifacts.some((a) => includesCI(String(a), cond.value))
      );
    case "and":
      return (cond.all || []).every((c) => evaluatePipelineCondition(c, ctx));
    case "or":
      return (cond.any || []).some((c) => evaluatePipelineCondition(c, ctx));
    default:
      return false;
  }
}

/**
 * Build linear + reject (+ optional cond / parallel) edges from ordered steps.
 */
export function synthesizePipelineEdges(
  input: PipelineGraphInput,
): PipelineEdge[] {
  const steps = input.steps || [];
  if (!steps.length) return [];

  const entry = (input.entry || "").trim() || steps[0]!.id;
  const parallelBranchIds = new Set<string>();
  for (const step of steps) {
    for (const b of step.parallel?.branches || []) parallelBranchIds.add(b);
  }

  const edges: PipelineEdge[] = [
    {
      id: edgeId("next", PIPELINE_GRAPH_START, entry),
      from: PIPELINE_GRAPH_START,
      to: entry,
      kind: "next",
      label: "",
    },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;

    for (let b = 0; b < (step.branches || []).length; b++) {
      const branch = step.branches![b]!;
      edges.push({
        id: edgeId("cond", step.id, branch.to, String(b)),
        from: step.id,
        to: branch.to,
        kind: "cond",
        when: branch.when,
        label: branch.label || "",
      });
    }

    const parallel = step.parallel;
    if (parallel?.branches && parallel.branches.length >= 2) {
      const thenTo = (parallel.then || "").trim() || PIPELINE_GRAPH_END;
      for (const branchId of parallel.branches) {
        edges.push({
          id: edgeId("parallel", step.id, branchId),
          from: step.id,
          to: branchId,
          kind: "parallel",
          label: parallel.join === "any" ? "并行(任一)" : "并行(全部)",
        });
        edges.push({
          id: edgeId("next", branchId, thenTo, "join"),
          from: branchId,
          to: thenTo,
          kind: "next",
          label: "汇合",
        });
      }
    } else if (!parallelBranchIds.has(step.id)) {
      // Explicit next (including null/"" = disconnected). Undefined = legacy linear.
      if (step.next !== undefined) {
        const to = (step.next || "").trim();
        if (to) {
          edges.push({
            id: edgeId("next", step.id, to),
            from: step.id,
            to,
            kind: "next",
            label: "",
          });
        }
      } else {
        const next = steps[i + 1];
        const linearTo = next ? next.id : PIPELINE_GRAPH_END;
        edges.push({
          id: edgeId("next", step.id, linearTo),
          from: step.id,
          to: linearTo,
          kind: "next",
          label: "",
        });
      }
    }

    const onReject = step.on_reject || "end";
    if (onReject === "retry_step") {
      edges.push({
        id: edgeId("reject", step.id, step.id),
        from: step.id,
        to: step.id,
        kind: "reject",
        label: "",
      });
    } else if (onReject === "goto" && (step.reject_goto || "").trim()) {
      const target = step.reject_goto!.trim();
      edges.push({
        id: edgeId("reject", step.id, target),
        from: step.id,
        to: target,
        kind: "reject",
        label: "",
      });
    } else {
      edges.push({
        id: edgeId("reject", step.id, PIPELINE_GRAPH_END),
        from: step.id,
        to: PIPELINE_GRAPH_END,
        kind: "reject",
        label: "",
      });
    }
  }

  return edges;
}

/**
 * Prefer stored edges when present; otherwise synthesize from linear steps.
 * Always returns a usable entry step id (falls back to first step).
 */
export function normalizePipelineGraph(input: PipelineGraphInput): {
  entry: string;
  edges: PipelineEdge[];
} {
  const steps = input.steps || [];
  const firstId = steps[0]?.id || "";
  const entry = (input.entry || "").trim() || firstId;
  const stored = (input.edges || []).filter(
    (e) => e && typeof e.from === "string" && typeof e.to === "string",
  );
  if (stored.length > 0) {
    return { entry: entry || firstId, edges: stored as PipelineEdge[] };
  }
  return {
    entry: entry || firstId,
    edges: synthesizePipelineEdges({ ...input, entry }),
  };
}

/**
 * When edges are source of truth, mirror cond edges onto step.branches for editors.
 */
export function syncBranchesFromEdges<
  T extends { id: string; branches?: PipelineStepBranch[] },
>(steps: T[], edges: PipelineEdge[]): T[] {
  return steps.map((step) => {
    const conds = edges.filter((e) => e.from === step.id && e.kind === "cond");
    if (!conds.length) {
      return { ...step, branches: step.branches || [] };
    }
    return {
      ...step,
      branches: conds.map((e) => ({
        to: e.to,
        label: e.label || "",
        when: (e.when || { op: "default" as const }) as PipelineCondition,
      })),
    };
  });
}

/**
 * Validate reject_goto / edge targets / cond `when` shapes.
 * Returns human-readable errors (empty = ok).
 */
export function validatePipelineGraph(input: PipelineGraphInput): string[] {
  const steps = input.steps || [];
  const ids = new Set(steps.map((s) => s.id));
  const errors: string[] = [];
  const { entry, edges } = normalizePipelineGraph(input);

  if (entry && !ids.has(entry)) {
    errors.push(`entry step not found: ${entry}`);
  }

  for (const step of steps) {
    if (step.on_reject === "goto") {
      const target = (step.reject_goto || "").trim();
      if (!target) {
        errors.push(`step ${step.id}: on_reject=goto requires reject_goto`);
      } else if (!ids.has(target)) {
        errors.push(`step ${step.id}: reject_goto not found: ${target}`);
      }
    }
    for (const [i, branch] of (step.branches || []).entries()) {
      const to = (branch.to || "").trim();
      if (!to) {
        errors.push(`step ${step.id} branch[${i}]: missing to`);
      } else if (to !== PIPELINE_GRAPH_END && !ids.has(to)) {
        errors.push(`step ${step.id} branch[${i}]: unknown to ${to}`);
      }
      const parsed = PipelineConditionSchema.safeParse(branch.when);
      if (!parsed.success) {
        errors.push(
          `step ${step.id} branch[${i}]: invalid when (${parsed.error.issues[0]?.message || "bad condition"})`,
        );
      }
    }
    const parallel = step.parallel;
    if (parallel?.branches?.length) {
      if ((step.branches || []).length) {
        errors.push(
          `step ${step.id}: cannot combine parallel with cond branches`,
        );
      }
      if (parallel.branches.length < 2) {
        errors.push(`step ${step.id}: parallel needs ≥2 branches`);
      }
      const uniq = new Set(parallel.branches);
      if (uniq.size !== parallel.branches.length) {
        errors.push(`step ${step.id}: parallel branches must be unique`);
      }
      for (const b of parallel.branches) {
        if (!ids.has(b)) {
          errors.push(`step ${step.id}: parallel branch not found: ${b}`);
        } else if (b === step.id) {
          errors.push(`step ${step.id}: parallel branch cannot be self`);
        }
        const branchStep = steps.find((s) => s.id === b);
        if (branchStep?.human_approval) {
          errors.push(
            `step ${step.id}: parallel branch ${b} must disable human_approval (并行分支暂不支持人工闸门)`,
          );
        }
        if (branchStep?.parallel?.branches?.length) {
          errors.push(
            `step ${step.id}: nested parallel on branch ${b} is not supported`,
          );
        }
      }
      const thenTo = (parallel.then || "").trim();
      if (thenTo && thenTo !== PIPELINE_GRAPH_END && !ids.has(thenTo)) {
        errors.push(`step ${step.id}: parallel.then not found: ${thenTo}`);
      }
      if (thenTo && parallel.branches.includes(thenTo)) {
        errors.push(`step ${step.id}: parallel.then cannot be a branch`);
      }
    }
  }

  for (const edge of edges) {
    const fromOk =
      edge.from === PIPELINE_GRAPH_START || ids.has(edge.from);
    const toOk =
      edge.to === PIPELINE_GRAPH_END ||
      edge.to === PIPELINE_GRAPH_START ||
      ids.has(edge.to);
    if (!fromOk) errors.push(`edge ${edge.id}: unknown from ${edge.from}`);
    if (!toOk) errors.push(`edge ${edge.id}: unknown to ${edge.to}`);
    if (edge.kind === "cond") {
      if (edge.when == null) {
        errors.push(`edge ${edge.id}: cond requires when`);
      } else {
        const parsed = PipelineConditionSchema.safeParse(edge.when);
        if (!parsed.success) {
          errors.push(`edge ${edge.id}: invalid when`);
        }
      }
    }
  }

  return errors;
}

/** Resolve the default `next` successor after approving `from` (or start). */
export function resolveNextEdge(
  edges: PipelineEdge[],
  from: string,
): PipelineEdge | undefined {
  return edges.find((e) => e.from === from && e.kind === "next");
}

/** Cond edges from a step, in declaration order. */
export function resolveCondEdges(
  edges: PipelineEdge[],
  from: string,
): PipelineEdge[] {
  return edges.filter((e) => e.from === from && e.kind === "cond");
}

/**
 * First matching `cond` edge, else the `next` edge.
 */
export function resolveApproveEdge(
  edges: PipelineEdge[],
  from: string,
  ctx: PipelineConditionContext,
): PipelineEdge | undefined {
  for (const edge of resolveCondEdges(edges, from)) {
    if (evaluatePipelineCondition(edge.when, ctx)) return edge;
  }
  return resolveNextEdge(edges, from);
}

/** Resolve the `reject` edge from a step (retry = self, end = __end__). */
export function resolveRejectEdge(
  edges: PipelineEdge[],
  from: string,
): PipelineEdge | undefined {
  return edges.find((e) => e.from === from && e.kind === "reject");
}

type RejectCompatStep = {
  id: string;
  on_reject?: "end" | "retry_step" | "goto";
  reject_goto?: string;
};

/** Keep step `on_reject` / `reject_goto` in sync with reject edges (compat). */
export function syncRejectFieldsFromEdges<T extends RejectCompatStep>(
  steps: T[],
  edges: PipelineEdge[],
): T[] {
  return steps.map((step) => {
    const rej = resolveRejectEdge(edges, step.id);
    if (!rej) return step;
    if (rej.to === step.id) {
      return { ...step, on_reject: "retry_step" as const, reject_goto: undefined };
    }
    if (rej.to === PIPELINE_GRAPH_END) {
      return { ...step, on_reject: "end" as const, reject_goto: undefined };
    }
    return {
      ...step,
      on_reject: "goto" as const,
      reject_goto: rej.to,
    };
  });
}
