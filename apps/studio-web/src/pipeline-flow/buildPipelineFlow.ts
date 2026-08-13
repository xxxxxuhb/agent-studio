import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { PipelineStep, WorkOrderRunStep } from "@agent-studio/agent-schema";
import { STEP_STATUS_LABEL } from "../work-orders/workOrderLabels";
import type { PipelineTerminalNodeData } from "./PipelineTerminalNode";

export type FlowPhase = "done" | "running" | "pending" | "failed" | "idle";

export type PipelineFlowNodeData = {
  label: string;
  agent: string;
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
  human_approval?: boolean;
  on_reject?: "end" | "retry_step" | "goto";
  reject_goto?: string;
  status?: string;
  summary?: string;
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

export function phaseFromRunStatus(status?: string): FlowPhase {
  switch (status) {
    case "approved":
    case "skipped":
      return "done";
    case "running":
    case "pending_approval":
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
    human_approval: s.human_approval,
    on_reject: s.on_reject,
    reject_goto: s.reject_goto,
  }));
}

export function toFlowStepsFromRun(steps: WorkOrderRunStep[]): FlowStepInput[] {
  return steps.map((s) => ({
    id: s.step_id,
    label: s.label,
    agent: s.agent,
    human_approval: s.human_approval,
    on_reject: s.on_reject,
    reject_goto: s.reject_goto,
    status: s.status,
    summary: s.summary,
  }));
}

function stepKindTags(s: FlowStepInput): Array<{ text: string; color?: string }> {
  if (s.human_approval) {
    return [{ text: "人工确认", color: "warning" }];
  }
  return [{ text: "自动推进", color: "blue" }];
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
  },
): { nodes: Node[]; edges: Edge[] } {
  const withStatus = Boolean(opts?.withStatus);
  const clickable = Boolean(opts?.clickable);
  const terminals = opts?.terminals !== false;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  let x = START_X;
  let prevId: string | null = null;

  if (terminals) {
    const startId = "__flow_start__";
    nodes.push({
      id: startId,
      type: "pipelineTerminal",
      position: { x, y: TERMINAL_Y },
      data: { kind: "start", label: "开始" } satisfies PipelineTerminalNodeData,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: TERMINAL_W },
      selectable: false,
      draggable: false,
      zIndex: 2,
    });
    prevId = startId;
    x += TERMINAL_W + GAP_X;
  }

  steps.forEach((s, i) => {
    const phase = withStatus ? phaseFromRunStatus(s.status) : "idle";
    const statusText = withStatus
      ? STEP_STATUS_LABEL[s.status || "pending"]?.text || s.status || "待执行"
      : s.human_approval
        ? "人工确认"
        : "自动推进";
    const id = s.id;
    const showRejectHandle =
      s.on_reject === "end" || s.on_reject === "goto" || Boolean(s.human_approval);
    nodes.push({
      id,
      type: "pipelineStep",
      position: { x, y: START_Y },
      data: {
        label: s.label || s.id,
        agent: s.agent,
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
      zIndex: 2,
    });

    if (prevId) {
      edges.push(
        seqEdge(
          `seq-${prevId}-${id}`,
          prevId,
          id,
          prevId === "__flow_start__" ? "进入" : "通过",
          withStatus &&
            phaseFromRunStatus(s.status) === "running" &&
            prevId !== "__flow_start__",
        ),
      );
    }
    prevId = id;
    x += NODE_W + GAP_X;
  });

  if (terminals) {
    const endId = "__flow_end__";
    nodes.push({
      id: endId,
      type: "pipelineTerminal",
      position: { x, y: TERMINAL_Y },
      data: { kind: "end", label: "结束" } satisfies PipelineTerminalNodeData,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: TERMINAL_W },
      selectable: false,
      draggable: false,
      zIndex: 2,
    });
    if (prevId) {
      edges.push(seqEdge(`seq-${prevId}-${endId}`, prevId, endId, "完成"));
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
    } else if (s.on_reject === "end" && terminals) {
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
