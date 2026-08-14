import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type {
  PipelineStep,
  PipelineStepBranch,
  WorkOrderRunStep,
} from "@agent-studio/agent-schema";
import { PIPELINE_GRAPH_END } from "@agent-studio/agent-schema";
import { STEP_STATUS_LABEL } from "../work-orders/workOrderLabels";
import type { PipelineTerminalNodeData } from "./PipelineTerminalNode";

export type FlowPhase = "done" | "running" | "pending" | "failed" | "idle";

export type PipelineFlowNodeData = {
  label: string;
  agent: string;
  /** Pipeline step kind for visual differentiation. */
  stepKind?: "agent" | "http" | "wait_event" | "ci" | "delay" | "gateway";
  /** Second line under title (agent id / url / event). */
  subtitle?: string;
  humanApproval: boolean;
  phase: FlowPhase;
  statusText: string;
  /** Extra kind tags shown on the node (e.g. 人工确认). */
  kindTags?: Array<{ text: string; color?: string }>;
  index: number;
  summary?: string;
  /** When true, node shows reject handle for visual editing. */
  editable?: boolean;
  /** Show bottom reject handle (preview reject edges). */
  showRejectHandle?: boolean;
  /** When true, node is clickable (run preview). */
  clickable?: boolean;
};

export type FlowStepInput = {
  id: string;
  label?: string;
  agent: string;
  kind?: "agent" | "http" | "wait_event" | "ci" | "delay" | "gateway";
  human_approval?: boolean;
  on_reject?: "end" | "retry_step" | "goto";
  reject_goto?: string;
  branches?: PipelineStepBranch[];
  status?: string;
  summary?: string;
  wait_event?: { event?: string } | null;
  http?: { url?: string; method?: string } | null;
  ci?: { trigger_url?: string } | null;
  delay?: { seconds?: number } | null;
  parallel?: { branches?: string[]; join?: string; then?: string } | null;
};

const NODE_W = 200;
const NODE_H = 88;
const TERMINAL_W = 96;
/** Wider gap so edge labels sit in the corridor between nodes. */
const GAP_X = 100;
const START_X = 28;
/** Leave headroom above for labels; reject arcs use space below. */
const START_Y = 28;
const TERMINAL_Y = 42;
const BRANCH_GAP_Y = 128;

/**
 * Left-to-right layout. Parallel branches share an X and stack on Y;
 * join/`then` sits in the next column.
 */
export function layoutPipelinePositions(
  steps: Array<{
    id: string;
    parallel?: { branches?: string[]; then?: string } | null;
  }>,
  opts?: { terminals?: boolean },
): Map<string, { x: number; y: number }> {
  const terminals = opts?.terminals !== false;
  const pos = new Map<string, { x: number; y: number }>();
  const branchMember = new Set<string>();
  for (const s of steps) {
    for (const id of s.parallel?.branches || []) branchMember.add(id);
  }

  let x = START_X;
  if (terminals) {
    pos.set("__flow_start__", { x, y: TERMINAL_Y });
    x += TERMINAL_W + GAP_X;
  }

  const placeBranchColumn = (branchIds: string[], colX: number) => {
    const gapY = BRANCH_GAP_Y;
    const totalH = branchIds.length * NODE_H + (branchIds.length - 1) * gapY;
    const top = START_Y + NODE_H / 2 - totalH / 2;
    branchIds.forEach((bid, i) => {
      pos.set(bid, { x: colX, y: Math.max(12, top + i * (NODE_H + gapY)) });
    });
  };

  for (const s of steps) {
    if (branchMember.has(s.id) || pos.has(s.id)) continue;
    const parallel = (s.parallel?.branches || []).filter(Boolean);
    if (parallel.length >= 2) {
      pos.set(s.id, { x, y: START_Y });
      const bx = x + NODE_W + GAP_X;
      placeBranchColumn(parallel, bx);
      x = bx + NODE_W + GAP_X;

      const thenRaw = (s.parallel?.then || "").trim();
      if (thenRaw && thenRaw !== PIPELINE_GRAPH_END && !pos.has(thenRaw)) {
        // Join target sits right after the branch column when it is a real step.
        if (steps.some((t) => t.id === thenRaw) && !branchMember.has(thenRaw)) {
          pos.set(thenRaw, { x, y: START_Y });
          x += NODE_W + GAP_X;
        }
      }
      continue;
    }
    pos.set(s.id, { x, y: START_Y });
    x += NODE_W + GAP_X;
  }

  for (const s of steps) {
    if (!pos.has(s.id)) {
      pos.set(s.id, { x, y: START_Y });
      x += NODE_W + GAP_X;
    }
  }

  if (terminals) {
    pos.set("__flow_end__", { x, y: TERMINAL_Y });
  }
  return pos;
}

export function phaseFromRunStatus(status?: string): FlowPhase {
  switch (status) {
    case "approved":
    case "skipped":
      return "done";
    case "running":
    case "pending_approval":
    case "waiting":
      return "running";
    case "rejected":
    case "failed":
      return "failed";
    case "pending":
      return "pending";
    default:
      return "idle";
  }
}

export function toFlowStepsFromPipeline(steps: PipelineStep[]): FlowStepInput[] {
  return steps.map((s) => ({
    id: s.id,
    label: s.label,
    agent: s.agent,
    kind: s.kind || "agent",
    human_approval: s.human_approval,
    on_reject: s.on_reject,
    reject_goto: s.reject_goto,
    branches: s.branches,
    parallel: s.parallel,
    http: s.http,
    wait_event: s.wait_event,
    ci: s.ci,
    delay: s.delay,
  }));
}

export function toFlowStepsFromRun(steps: WorkOrderRunStep[]): FlowStepInput[] {
  return steps.map((s) => ({
    id: s.step_id,
    label: s.label,
    agent: s.agent,
    kind: s.kind || "agent",
    human_approval: s.human_approval,
    on_reject: s.on_reject,
    reject_goto: s.reject_goto,
    status: s.status,
    summary: s.summary,
    parallel: s.parallel,
    http: s.http,
    wait_event: s.wait_event,
    ci: s.ci,
    delay: s.delay,
  }));
}

const KIND_TAG: Record<
  NonNullable<FlowStepInput["kind"]>,
  { text: string; color: string }
> = {
  agent: { text: "Agent", color: "blue" },
  http: { text: "HTTP", color: "purple" },
  wait_event: { text: "等待事件", color: "cyan" },
  ci: { text: "CI", color: "geekblue" },
  delay: { text: "延时", color: "geekblue" },
  gateway: { text: "控制", color: "orange" },
};

function stepKindTags(s: FlowStepInput): Array<{ text: string; color?: string }> {
  const kind = s.kind || "agent";
  if (kind === "gateway") {
    if (s.parallel != null) return [{ text: "并行网关", color: "cyan" }];
    return [{ text: "条件网关", color: "orange" }];
  }
  const tags = [KIND_TAG[kind] || KIND_TAG.agent];
  if (kind === "agent") {
    tags.push(
      s.human_approval
        ? { text: "人工确认", color: "warning" }
        : { text: "自动推进", color: "default" },
    );
  }
  return tags;
}

export function stepSubtitle(s: FlowStepInput): string {
  const kind = s.kind || "agent";
  if (kind === "http") {
    const url = (s.http?.url || "").trim();
    return url ? `${s.http?.method || "POST"} ${url}` : "HTTP 请求";
  }
  if (kind === "wait_event") {
    const ev = s.wait_event?.event || "manual";
    if (ev === "mr_merged") return "等 MR/PR 合并";
    if (ev === "issue_labeled") return "等 Issue 打标签";
    return "等外部事件";
  }
  if (kind === "ci") {
    const url = (s.ci?.trigger_url || "").trim();
    return url || "CI 触发 / 轮询";
  }
  if (kind === "delay") {
    return `等待 ${s.delay?.seconds || 60}s`;
  }
  if (kind === "gateway") {
    if (s.parallel?.branches?.length) {
      return `并行 ×${s.parallel.branches.length}`;
    }
    if (s.branches?.length) {
      return `条件 ×${s.branches.length}`;
    }
    return "控制节点";
  }
  return s.agent ? `@${s.agent}` : "@agent";
}

function seqEdge(
  id: string,
  source: string,
  target: string,
  label: string,
  animated?: boolean,
): Edge {
  return {
    id,
    source,
    target,
    sourceHandle: "out",
    targetHandle: "in",
    type: "smoothstep",
    animated: Boolean(animated),
    label,
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
    labelBgStyle: { fill: "#fafbfd", fillOpacity: 0.95 },
    style: { stroke: "#69b1ff", strokeWidth: 2 },
    labelStyle: { fontSize: 11, fill: "#595959", fontWeight: 500 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: "#69b1ff",
    },
    zIndex: 1,
  };
}

function rejectEdge(
  id: string,
  source: string,
  target: string,
  label: string,
  offset: number,
  targetHandle = "reject-in",
): Edge {
  return {
    id,
    source,
    target,
    sourceHandle: "reject",
    targetHandle,
    type: "smoothstep",
    label,
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
    labelBgStyle: { fill: "#fff2f0", fillOpacity: 0.95 },
    style: { stroke: "#ff7875", strokeWidth: 1.5, strokeDasharray: "6 4" },
    labelStyle: { fontSize: 11, fill: "#cf1322", fontWeight: 500 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: "#ff7875",
    },
    zIndex: 0,
    // @xyflow smoothstep offset — typed loosely across versions
    ...({ pathOptions: { offset, borderRadius: 16 } } as object),
  } as Edge;
}

export function buildPipelineFlowGraph(
  steps: FlowStepInput[],
  opts?: {
    withStatus?: boolean;
    clickable?: boolean;
    /** Include 开始 / 结束 terminal nodes (default true). */
    terminals?: boolean;
    /** Draw reject→end arcs (default false; clutter). */
    rejectToEnd?: boolean;
  },
): { nodes: Node[]; edges: Edge[] } {
  const withStatus = Boolean(opts?.withStatus);
  const clickable = Boolean(opts?.clickable);
  const terminals = opts?.terminals !== false;
  const rejectToEnd = Boolean(opts?.rejectToEnd);

  const layout = layoutPipelinePositions(steps, { terminals });
  const parallelBranchIds = new Set<string>();
  for (const s of steps) {
    for (const b of s.parallel?.branches || []) parallelBranchIds.add(b);
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  if (terminals) {
    const startPos = layout.get("__flow_start__") || { x: START_X, y: TERMINAL_Y };
    nodes.push({
      id: "__flow_start__",
      type: "pipelineTerminal",
      position: startPos,
      data: { kind: "start", label: "开始" } satisfies PipelineTerminalNodeData,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: TERMINAL_W },
      selectable: false,
      draggable: false,
      zIndex: 2,
    });
  }

  steps.forEach((s, i) => {
    const kind = s.kind || "agent";
    const phase = withStatus ? phaseFromRunStatus(s.status) : "idle";
    const statusText = withStatus
      ? STEP_STATUS_LABEL[s.status || "pending"]?.text || s.status || "待执行"
      : kind === "wait_event"
        ? "等待事件"
        : kind === "http"
          ? "HTTP"
          : kind === "ci"
            ? "CI"
            : kind === "delay"
              ? "延时"
              : kind === "gateway"
                ? "控制"
                : s.human_approval
                  ? "人工确认"
                  : "自动推进";
    const id = s.id;
    const showRejectHandle =
      s.on_reject === "end" || s.on_reject === "goto" || Boolean(s.human_approval);
    nodes.push({
      id,
      type: "pipelineStep",
      position: layout.get(id) || {
        x: START_X + (i + 1) * (NODE_W + GAP_X),
        y: START_Y,
      },
      data: {
        label: s.label || s.id,
        agent: s.agent,
        stepKind: kind,
        subtitle: stepSubtitle(s),
        humanApproval: Boolean(s.human_approval),
        phase,
        statusText,
        kindTags: stepKindTags(s),
        index: i + 1,
        summary: s.summary,
        clickable,
        showRejectHandle,
      } satisfies PipelineFlowNodeData,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: NODE_W, cursor: clickable ? "pointer" : undefined },
      className: `pipeline-flow-node-wrap pipeline-flow-node-wrap--${kind}`,
      zIndex: 2,
    });
  });

  if (terminals) {
    const endPos = layout.get("__flow_end__") || {
      x: START_X + (steps.length + 1) * (NODE_W + GAP_X),
      y: TERMINAL_Y,
    };
    nodes.push({
      id: "__flow_end__",
      type: "pipelineTerminal",
      position: endPos,
      data: { kind: "end", label: "结束" } satisfies PipelineTerminalNodeData,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: TERMINAL_W },
      selectable: false,
      draggable: false,
      zIndex: 2,
    });
  }

  const entry =
    steps.find((s) => !parallelBranchIds.has(s.id))?.id || steps[0]?.id;
  if (terminals && entry) {
    edges.push(
      seqEdge(`seq-__flow_start__-${entry}`, "__flow_start__", entry, "进入"),
    );
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const next = steps[i + 1];
    const linearTo = next ? next.id : terminals ? "__flow_end__" : "";
    const parallel = step.parallel;

    if (parallel?.branches && parallel.branches.length >= 2) {
      const thenRaw = (parallel.then || "").trim();
      const thenTo =
        !thenRaw || thenRaw === PIPELINE_GRAPH_END
          ? terminals
            ? "__flow_end__"
            : ""
          : thenRaw;
      for (const branchId of parallel.branches) {
        if (!steps.some((x) => x.id === branchId)) continue;
        edges.push({
          id: `parallel-${step.id}-${branchId}`,
          source: step.id,
          target: branchId,
          sourceHandle: "out",
          targetHandle: "in",
          type: "smoothstep",
          label: parallel.join === "any" ? "并行(任一)" : "并行(全部)",
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: "#e6fffb", fillOpacity: 0.95 },
          style: {
            stroke: "#13c2c2",
            strokeWidth: 1.5,
            strokeDasharray: "2 4",
          },
          labelStyle: { fontSize: 11, fill: "#08979c", fontWeight: 500 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: "#13c2c2",
          },
          zIndex: 1,
        });
        if (thenTo) {
          edges.push(
            seqEdge(
              `join-${branchId}-${thenTo}`,
              branchId,
              thenTo,
              "汇合",
            ),
          );
        }
      }
    } else if (!parallelBranchIds.has(step.id) && linearTo) {
      edges.push(
        seqEdge(
          `seq-${step.id}-${linearTo}`,
          step.id,
          linearTo,
          next ? "通过" : "完成",
          withStatus && phaseFromRunStatus(step.status) === "running",
        ),
      );
    }

    for (const [bi, branch] of (step.branches || []).entries()) {
      const toEnd = branch.to === PIPELINE_GRAPH_END;
      if (toEnd && !terminals) continue;
      if (!toEnd && !steps.some((x) => x.id === branch.to)) continue;
      const target = toEnd ? "__flow_end__" : branch.to;
      edges.push({
        id: `cond-${step.id}-${branch.to}-${bi}`,
        source: step.id,
        target,
        sourceHandle: "out",
        targetHandle: toEnd ? "reject-in" : "in",
        type: "smoothstep",
        label: branch.label || "条件",
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: "#f9f0ff", fillOpacity: 0.95 },
        style: {
          stroke: "#722ed1",
          strokeWidth: 1.5,
          strokeDasharray: "4 3",
        },
        labelStyle: { fontSize: 11, fill: "#531dab", fontWeight: 500 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: "#722ed1",
        },
        zIndex: 0,
      });
    }
  }

  let rejectIdx = 0;
  for (const s of steps) {
    if (s.on_reject === "goto" && s.reject_goto) {
      const target = steps.find((x) => x.id === s.reject_goto);
      if (!target) continue;
      edges.push(
        rejectEdge(
          `reject-${s.id}-${s.reject_goto}`,
          s.id,
          s.reject_goto,
          "驳回跳转",
          28 + rejectIdx * 22,
          "in",
        ),
      );
      rejectIdx += 1;
    } else if (rejectToEnd && s.on_reject === "end" && terminals) {
      edges.push(
        rejectEdge(
          `reject-end-${s.id}`,
          s.id,
          "__flow_end__",
          "驳回",
          36 + rejectIdx * 24,
          "reject-in",
        ),
      );
      rejectIdx += 1;
    }
  }

  return { nodes, edges };
}

export function fitFlowWidth(stepCount: number, terminals = true): number {
  const term = terminals ? 2 * (TERMINAL_W + GAP_X) : 0;
  return Math.max(
    560,
    START_X * 2 + term + stepCount * NODE_W + Math.max(0, stepCount - 1) * GAP_X,
  );
}

export { NODE_W, NODE_H, TERMINAL_W, GAP_X };
