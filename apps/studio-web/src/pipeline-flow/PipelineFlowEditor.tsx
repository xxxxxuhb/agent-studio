import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  AppstoreOutlined,
  DeleteOutlined,
  PartitionOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type {
  PipelineCiStep,
  PipelineCondition,
  PipelineDelayStep,
  PipelineHttpStep,
  PipelineStepBranch,
  PipelineStepKind,
  PipelineStepParallel,
  PipelineWaitEventStep,
} from "@agent-studio/agent-schema";
import { PIPELINE_GRAPH_END } from "@agent-studio/agent-schema";
import {
  NODE_W,
  layoutPipelinePositions,
  stepSubtitle,
  type PipelineFlowNodeData,
} from "./buildPipelineFlow";
import {
  FLOW_END_ID,
  FLOW_START_ID,
  PipelinePalette,
  parsePaletteDrag,
  type PipelinePaletteDragPayload,
} from "./PipelinePalette";
import { PipelineStepNode } from "./PipelineStepNode";
import {
  PipelineTerminalNode,
  type PipelineTerminalNodeData,
} from "./PipelineTerminalNode";

export type EditablePipelineStep = {
  id: string;
  agent: string;
  label?: string;
  kind?: PipelineStepKind;
  human_approval: boolean;
  on_reject: "end" | "retry_step" | "goto";
  reject_goto?: string;
  /** Explicit successor; null = unconnected. */
  next?: string | null;
  branches?: PipelineStepBranch[];
  parallel?: PipelineStepParallel | null;
  http?: PipelineHttpStep | null;
  wait_event?: PipelineWaitEventStep | null;
  ci?: PipelineCiStep | null;
  delay?: PipelineDelayStep | null;
};

type AgentOption = { value: string; label: string };

type Props = {
  value?: EditablePipelineStep[];
  onChange?: (next: EditablePipelineStep[]) => void;
  agentOptions: AgentOption[];
  height?: number | string;
  /** Drop「定时」物料时追加 cron 触发器（流水线级）. */
  onAddCronTrigger?: () => void;
  /** Flow entry step id (开始 → entry). */
  entry?: string;
  onEntryChange?: (entry: string) => void;
};

const nodeTypes: NodeTypes = {
  pipelineStep: PipelineStepNode,
  pipelineTerminal: PipelineTerminalNode,
};

const GAP_X = 56;
const START_X = 32;
const START_Y = 72;
const TERMINAL_Y = 86;

const KIND_META: Record<
  PipelineStepKind,
  { tag: string; color: string; defaultLabel: string }
> = {
  agent: { tag: "Agent", color: "blue", defaultLabel: "Agent 步骤" },
  http: { tag: "HTTP", color: "purple", defaultLabel: "HTTP 请求" },
  wait_event: { tag: "等待事件", color: "cyan", defaultLabel: "等待事件" },
  ci: { tag: "CI", color: "geekblue", defaultLabel: "CI 触发" },
  delay: { tag: "延时", color: "geekblue", defaultLabel: "延时等待" },
  gateway: { tag: "控制", color: "orange", defaultLabel: "控制节点" },
};

function kindTagsFor(s: EditablePipelineStep): Array<{ text: string; color?: string }> {
  const kind = s.kind || "agent";
  if (kind === "gateway") {
    if (s.parallel != null) {
      return [{ text: "并行网关", color: "cyan" }];
    }
    return [{ text: "条件网关", color: "orange" }];
  }
  const tags = [
    {
      text: KIND_META[kind]?.tag || "Agent",
      color: KIND_META[kind]?.color || "blue",
    },
  ];
  if (kind === "agent") {
    tags.push(
      s.human_approval
        ? { text: "人工确认", color: "warning" }
        : { text: "自动推进", color: "default" },
    );
  }
  return tags;
}

/** Left-to-right layout; parallel branches stack vertically. */
function computeAutoLayout(
  steps: EditablePipelineStep[],
): Map<string, { x: number; y: number }> {
  return layoutPipelinePositions(steps, { terminals: true });
}

function buildNodes(
  steps: EditablePipelineStep[],
  prev?: Node[],
  layout?: Map<string, { x: number; y: number }>,
): Node[] {
  const prevPos = new Map(prev?.map((n) => [n.id, n.position]));
  const pick = (id: string, fallback: { x: number; y: number }) =>
    layout?.get(id) ?? prevPos.get(id) ?? fallback;

  const stepNodes: Node[] = steps.map((s, i) => {
    const kind = s.kind || "agent";
    return {
      id: s.id,
      type: "pipelineStep",
      position: pick(s.id, {
        x: START_X + (i + 1) * (NODE_W + GAP_X),
        y: START_Y,
      }),
      data: {
        label: s.label || s.id,
        agent: s.agent,
        stepKind: kind,
        subtitle: stepSubtitle({
          id: s.id,
          agent: s.agent,
          kind,
          http: s.http,
          wait_event: s.wait_event,
          ci: s.ci,
          delay: s.delay,
          parallel: s.parallel,
          branches: s.branches,
        }),
        humanApproval: Boolean(s.human_approval),
        phase: "idle",
        statusText: KIND_META[kind]?.tag || "Agent",
        kindTags: kindTagsFor(s),
        index: i + 1,
        editable: true,
        showRejectHandle: kind !== "gateway",
        clickable: true,
      } satisfies PipelineFlowNodeData,
      deletable: true,
    };
  });

  const firstStepX = stepNodes[0]?.position.x ?? START_X + NODE_W + GAP_X;
  const lastStepX =
    stepNodes[stepNodes.length - 1]?.position.x ?? firstStepX;

  const startNode: Node = {
    id: FLOW_START_ID,
    type: "pipelineTerminal",
    position: pick(FLOW_START_ID, {
      x: Math.max(8, firstStepX - NODE_W - GAP_X),
      y: TERMINAL_Y,
    }),
    data: { kind: "start", label: "开始" } satisfies PipelineTerminalNodeData,
    deletable: false,
    selectable: true,
  };
  const endNode: Node = {
    id: FLOW_END_ID,
    type: "pipelineTerminal",
    position: pick(FLOW_END_ID, {
      x: lastStepX + NODE_W + GAP_X,
      y: TERMINAL_Y,
    }),
    data: { kind: "end", label: "结束" } satisfies PipelineTerminalNodeData,
    deletable: false,
    selectable: true,
  };

  return [startNode, ...stepNodes, endNode];
}

function seqStyleEdge(opts: {
  id: string;
  source: string;
  target: string;
  label: string;
  color?: string;
  dashed?: boolean;
  deletable?: boolean;
}): Edge {
  const color = opts.color || "#91caff";
  return {
    id: opts.id,
    source: opts.source,
    target: opts.target,
    sourceHandle: "out",
    targetHandle: "in",
    type: "smoothstep",
    selectable: true,
    focusable: true,
    interactionWidth: 28,
    deletable: opts.deletable !== false,
    label: opts.label,
    style: {
      stroke: color,
      strokeWidth: opts.dashed ? 1.5 : 2,
      ...(opts.dashed ? { strokeDasharray: "2 4" } : {}),
    },
    labelStyle: {
      fontSize: 11,
      fill: opts.color === "#13c2c2" ? "#08979c" : "#8c8c8c",
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color,
    },
  };
}

function buildEdges(
  steps: EditablePipelineStep[],
  entry?: string,
): Edge[] {
  const edges: Edge[] = [];
  // Empty canvas: 开始 / 结束 only — no auto start→end edge.

  const parallelBranchIds = new Set<string>();
  for (const s of steps) {
    for (const b of s.parallel?.branches || []) parallelBranchIds.add(b);
  }

  const entryId = (entry || "").trim();
  if (entryId && steps.some((s) => s.id === entryId)) {
    edges.push(
      seqStyleEdge({
        id: `seq-${FLOW_START_ID}-${entryId}`,
        source: FLOW_START_ID,
        target: entryId,
        label: "进入",
      }),
    );
  }

  for (const step of steps) {
    const parallel = step.parallel;

    if (parallel?.branches && parallel.branches.length >= 1) {
      const thenRaw = (parallel.then || "").trim();
      const thenTo =
        !thenRaw || thenRaw === PIPELINE_GRAPH_END ? FLOW_END_ID : thenRaw;
      for (const branchId of parallel.branches) {
        if (!steps.some((x) => x.id === branchId)) continue;
        edges.push(
          seqStyleEdge({
            id: `parallel-${step.id}-${branchId}`,
            source: step.id,
            target: branchId,
            label: parallel.join === "any" ? "并行(任一)" : "并行(全部)",
            color: "#13c2c2",
            dashed: true,
          }),
        );
        // Only draw join when then is explicitly set (incl. __end__).
        if (thenRaw) {
          edges.push(
            seqStyleEdge({
              id: `join-${step.id}-${branchId}-${thenTo}`,
              source: branchId,
              target: thenTo,
              label: "汇合",
              color: "#13c2c2",
            }),
          );
        }
      }
    } else if (!parallelBranchIds.has(step.id)) {
      const to = (step.next || "").trim();
      if (to) {
        const target =
          to === PIPELINE_GRAPH_END || to === FLOW_END_ID ? FLOW_END_ID : to;
        if (
          target === FLOW_END_ID ||
          steps.some((x) => x.id === target)
        ) {
          edges.push(
            seqStyleEdge({
              id: `seq-${step.id}-${target}`,
              source: step.id,
              target,
              label: target === FLOW_END_ID ? "完成" : "下一步",
            }),
          );
        }
      }
    }

    for (const [bi, branch] of (step.branches || []).entries()) {
      const toEnd = branch.to === PIPELINE_GRAPH_END;
      if (!branch.to || (!toEnd && !steps.some((x) => x.id === branch.to))) {
        continue;
      }
      edges.push({
        id: `cond-${step.id}-${branch.to}-${bi}`,
        source: step.id,
        target: toEnd ? FLOW_END_ID : branch.to,
        sourceHandle: "out",
        targetHandle: "in",
        type: "smoothstep",
        selectable: true,
        focusable: true,
        label: branch.label || condLabel(branch.when),
        data: {
          edgeKind: "cond",
          sourceId: step.id,
          branchIndex: bi,
        },
        style: { stroke: "#722ed1", strokeWidth: 1.5, strokeDasharray: "4 3" },
        labelStyle: { fontSize: 11, fill: "#531dab" },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: "#722ed1",
        },
      });
    }

    if (
      step.on_reject === "goto" &&
      step.reject_goto &&
      steps.some((x) => x.id === step.reject_goto)
    ) {
      edges.push({
        id: `reject-${step.id}-${step.reject_goto}`,
        source: step.id,
        target: step.reject_goto,
        sourceHandle: "reject",
        targetHandle: "in",
        type: "smoothstep",
        label: "驳回跳转",
        style: { stroke: "#ff7875", strokeWidth: 1.5, strokeDasharray: "6 4" },
        labelStyle: { fontSize: 11, fill: "#cf1322" },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: "#ff7875",
        },
      });
    }
  }

  return edges;
}

function condLabel(when: PipelineCondition | undefined): string {
  if (!when) return "条件";
  switch (when.op) {
    case "default":
      return "默认";
    case "feedback_includes":
      return `反馈含「${when.value}」`;
    case "feedback_matches":
      return `反馈~/${when.value}/`;
    case "summary_includes":
      return `摘要含「${when.value}」`;
    case "artifact_includes":
      return `产物含「${when.value}」`;
    case "and":
      return "且";
    case "or":
      return "或";
    default:
      return "条件";
  }
}

function defaultBranch(): PipelineStepBranch {
  return {
    to: "",
    label: "",
    when: { op: "feedback_includes", value: "" },
  };
}

function nextIds(steps: EditablePipelineStep[], count: number): string[] {
  const used = new Set(steps.map((s) => s.id));
  const out: string[] = [];
  let n = steps.length + 1;
  while (out.length < count) {
    const id = `step_${n}`;
    if (!used.has(id) && !out.includes(id)) out.push(id);
    n += 1;
  }
  return out;
}

function emptyStep(
  id: string,
  patch: Partial<EditablePipelineStep> & { kind: PipelineStepKind },
): EditablePipelineStep {
  return {
    id,
    agent: patch.agent || "",
    label: patch.label || KIND_META[patch.kind].defaultLabel,
    kind: patch.kind,
    human_approval: patch.human_approval ?? false,
    on_reject: patch.on_reject || "end",
    reject_goto: patch.reject_goto,
    next: patch.next !== undefined ? patch.next : null,
    branches: patch.branches,
    parallel: patch.parallel ?? null,
    http: patch.http ?? null,
    wait_event: patch.wait_event ?? null,
    ci: patch.ci ?? null,
    delay: patch.delay ?? null,
  };
}

function isConditionGateway(step: EditablePipelineStep): boolean {
  return (step.kind || "agent") === "gateway" && step.parallel == null;
}

function isParallelGateway(step: EditablePipelineStep): boolean {
  return (step.kind || "agent") === "gateway" && step.parallel != null;
}

function findParallelParent(
  steps: EditablePipelineStep[],
  branchId: string,
): EditablePipelineStep | null {
  return (
    steps.find((s) => (s.parallel?.branches || []).includes(branchId)) || null
  );
}

function defaultWhenForBranchIndex(index: number): PipelineCondition {
  if (index === 0) return { op: "feedback_includes", value: "通过" };
  if (index === 1) return { op: "default" };
  return { op: "feedback_includes", value: "" };
}

/** Returns steps to place from palette materials (gateways included). */
function createStepsFromPayload(
  steps: EditablePipelineStep[],
  payload: Exclude<
    PipelinePaletteDragPayload,
    { kind: "terminal" } | { kind: "cron_trigger" }
  >,
  agentOptions: AgentOption[],
): { appended: EditablePipelineStep[]; selectId: string } {
  if (payload.kind === "condition") {
    const [id] = nextIds(steps, 1);
    const step = emptyStep(id, {
      kind: "gateway",
      label: "条件网关",
      human_approval: false,
      branches: [],
      parallel: null,
    });
    return { appended: [step], selectId: id };
  }

  if (payload.kind === "parallel") {
    const [id] = nextIds(steps, 1);
    const step = emptyStep(id, {
      kind: "gateway",
      label: "并行网关",
      human_approval: false,
      branches: undefined,
      parallel: { branches: [], join: "all", then: "" },
    });
    return { appended: [step], selectId: id };
  }

  const [id] = nextIds(steps, 1);
  if (payload.kind === "agent") {
    const agent =
      payload.agent || agentOptions[0]?.value || "requirement";
    const step = emptyStep(id, {
      kind: "agent",
      agent,
      label:
        payload.label ||
        agentOptions.find((a) => a.value === agent)?.label.split(" (")[0] ||
        agent,
      human_approval: true,
    });
    step.agent = agent;
    return { appended: [step], selectId: id };
  }
  if (payload.kind === "http") {
    return {
      appended: [
        emptyStep(id, {
          kind: "http",
          label: "HTTP 请求",
          http: {
            url: "",
            method: "POST",
            headers: {},
            body: "",
            success_statuses: [200, 201, 202, 204],
            timeout_ms: 30_000,
          },
        }),
      ],
      selectId: id,
    };
  }
  if (payload.kind === "wait_event") {
    return {
      appended: [
        emptyStep(id, {
          kind: "wait_event",
          label: "等待 MR 合并",
          wait_event: { event: "mr_merged", labels: [] },
        }),
      ],
      selectId: id,
    };
  }
  if (payload.kind === "delay") {
    return {
      appended: [
        emptyStep(id, {
          kind: "delay",
          label: "延时 60s",
          delay: { seconds: 60 },
        }),
      ],
      selectId: id,
    };
  }
  if (payload.kind === "ci") {
    return {
      appended: [
        emptyStep(id, {
          kind: "ci",
          label: "CI 触发",
          ci: {
            trigger_url: "",
            method: "POST",
            headers: {},
            body: "",
            success_statuses: [200, 201, 202, 204],
            timeout_ms: 30_000,
            poll_url: "",
            poll_interval_ms: 5_000,
            poll_timeout_ms: 600_000,
            success_includes: "success",
            failure_includes: "failure",
          },
        }),
      ],
      selectId: id,
    };
  }
  // fallback agent
  const step = emptyStep(id, {
    kind: "agent",
    agent: agentOptions[0]?.value || "requirement",
    human_approval: true,
  });
  step.agent = agentOptions[0]?.value || "requirement";
  return { appended: [step], selectId: id };
}

function sortStepsByNodes(
  steps: EditablePipelineStep[],
  nodes: Node[],
): EditablePipelineStep[] {
  const order = [...nodes]
    .filter((n) => n.id !== FLOW_START_ID && n.id !== FLOW_END_ID)
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
    .map((n) => n.id);
  const map = new Map(steps.map((s) => [s.id, s]));
  return order.map((id) => map.get(id)!).filter(Boolean);
}

function EditorCanvas({
  value = [],
  onChange,
  agentOptions,
  height = 420,
  onAddCronTrigger,
  entry: entryProp,
  onEntryChange: onEntryChangeProp,
}: Props) {
  const steps = value;
  const form = Form.useFormInstance();
  const entryWatched = Form.useWatch("entry", form) as string | undefined;
  const entry = entryProp ?? entryWatched ?? "";
  function setEntry(next: string) {
    onEntryChangeProp?.(next);
    form.setFieldValue("entry", next);
  }
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{
    sourceId: string;
    branchIndex: number;
  } | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, getNodes, screenToFlowPosition } = useReactFlow();
  const pendingDropPos = useRef<{ id: string; x: number; y: number } | null>(
    null,
  );
  /** Force structural re-layout (parallel / condition / first paint). */
  const pendingAutoLayout = useRef(true);

  const stepIdsKey = useMemo(
    () =>
      steps
        .map(
          (s) =>
            `${s.id}|${s.kind || "agent"}|${s.agent}|${s.label || ""}|${s.human_approval}|${s.on_reject}|${s.reject_goto || ""}|${s.next || ""}|${JSON.stringify(s.branches || [])}|${JSON.stringify(s.parallel || null)}|${JSON.stringify(s.http || null)}|${JSON.stringify(s.wait_event || null)}|${JSON.stringify(s.ci || null)}|${JSON.stringify(s.delay || null)}`,
        )
        .join(";"),
    [steps],
  );

  useEffect(() => {
    setNodes((prev) => {
      const drop = pendingDropPos.current;
      // Drop always wins: place at pointer, never auto-layout over it.
      if (drop) {
        pendingAutoLayout.current = false;
        const built = buildNodes(steps, prev.length ? prev : undefined);
        pendingDropPos.current = null;
        return built.map((n) =>
          n.id === drop.id
            ? { ...n, position: { x: drop.x, y: drop.y } }
            : n,
        );
      }

      const missingBranch = steps.some((s) =>
        (s.parallel?.branches || []).some(
          (id) => !prev.some((n) => n.id === id),
        ),
      );
      const flatParallel = steps.some((s) => {
        const ys = (s.parallel?.branches || [])
          .map((id) => prev.find((n) => n.id === id)?.position.y)
          .filter((y): y is number => typeof y === "number");
        return ys.length >= 2 && ys.every((y) => y === ys[0]);
      });
      const forceLayout =
        pendingAutoLayout.current ||
        !prev.length ||
        missingBranch ||
        flatParallel;
      pendingAutoLayout.current = false;

      const layout = forceLayout ? computeAutoLayout(steps) : undefined;
      return buildNodes(steps, forceLayout ? undefined : prev, layout);
    });
    setEdges(
      buildEdges(steps, entry).map((e) => ({
        ...e,
        selected: e.id === selectedEdgeId,
      })),
    );
    if (selectedId && !steps.some((s) => s.id === selectedId)) {
      if (selectedId !== FLOW_START_ID && selectedId !== FLOW_END_ID) {
        setSelectedId(null);
        setConfigOpen(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdsKey, entry]);

  useEffect(() => {
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        selected: e.id === selectedEdgeId,
      })),
    );
  }, [selectedEdgeId, setEdges]);

  const selected = steps.find((s) => s.id === selectedId) || null;
  const selectedTerminal =
    selectedId === FLOW_START_ID || selectedId === FLOW_END_ID
      ? selectedId
      : null;

  function emit(next: EditablePipelineStep[]) {
    onChange?.(next);
  }

  function patchSelected(patch: Partial<EditablePipelineStep>) {
    if (!selected) return;
    const next = steps.map((s) => {
      if (s.id !== selected.id) return s;
      const merged = { ...s, ...patch };
      if (merged.on_reject !== "goto") merged.reject_goto = undefined;
      return merged;
    });
    if (patch.id && patch.id !== selected.id) {
      const id = patch.id.trim();
      if (!/^[a-z][a-z0-9_]*$/.test(id)) {
        message.warning("步骤 ID 需为 snake_case");
        return;
      }
      if (steps.some((s) => s.id === id && s.id !== selected.id)) {
        message.warning("步骤 ID 已存在");
        return;
      }
      emit(
        next.map((s) => ({
          ...s,
          id: s.id === selected.id ? id : s.id,
          reject_goto: s.reject_goto === selected.id ? id : s.reject_goto,
        })),
      );
      setSelectedId(id);
      return;
    }
    emit(next);
  }

  function addStepFromPalette(
    payload: PipelinePaletteDragPayload,
    position?: { x: number; y: number },
  ) {
    if (payload.kind === "terminal") {
      const id =
        payload.terminal === "start" ? FLOW_START_ID : FLOW_END_ID;
      if (position) {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === id
              ? { ...n, position: { x: position.x, y: position.y } }
              : n,
          ),
        );
      }
      setSelectedId(id);
      message.info(
        payload.terminal === "start"
          ? "开始节点已在画布上（可拖动定位）"
          : "结束节点已在画布上（可拖动定位）",
      );
      return;
    }

    if (payload.kind === "cron_trigger") {
      if (onAddCronTrigger) onAddCronTrigger();
      else message.info("请在底部「自动触发」中配置 cron");
      return;
    }

    const { appended, selectId } = createStepsFromPayload(
      steps,
      payload,
      agentOptions,
    );
    if (position) {
      pendingDropPos.current = {
        id: selectId,
        x: position.x,
        y: position.y,
      };
    }
    pendingAutoLayout.current = false;
    emit([...steps, ...appended]);
    setSelectedId(selectId);
    setSelectedEdgeId(null);
    setSelectedEdge(null);
    setConfigOpen(false);
    if (payload.kind === "condition") {
      message.info("从条件网关拉出连线到目标，再点击紫色边配置条件");
    } else if (payload.kind === "parallel") {
      message.info("从并行网关连到各支路，再从支路连到汇合点");
    }
  }

  function removeSelected() {
    if (selectedTerminal) {
      message.info("开始 / 结束节点为固定节点，不可删除");
      return;
    }
    if (!selected) return;
    const removed = selected.id;
    const removedNext = (selected.next || "").trim() || null;
    let nextEntry = entry;
    if (nextEntry === removed) {
      nextEntry =
        removedNext &&
        removedNext !== PIPELINE_GRAPH_END &&
        steps.some((s) => s.id === removedNext)
          ? removedNext
          : "";
    }
    const nextSteps = steps
      .filter((s) => s.id !== removed)
      .map((s) => {
        let patched = s;
        if (s.reject_goto === removed) {
          patched = {
            ...patched,
            on_reject: "end" as const,
            reject_goto: undefined,
          };
        }
        if (s.next === removed) {
          patched = { ...patched, next: removedNext };
        }
        if ((s.branches || []).some((b) => b.to === removed)) {
          patched = {
            ...patched,
            branches: (patched.branches || []).map((b) =>
              b.to === removed
                ? { ...b, to: removedNext || PIPELINE_GRAPH_END }
                : b,
            ),
          };
        }
        if (s.parallel?.branches?.includes(removed)) {
          const branches = (s.parallel.branches || []).filter(
            (id) => id !== removed,
          );
          patched = {
            ...patched,
            parallel:
              branches.length >= 2
                ? { ...s.parallel, branches }
                : null,
          };
        }
        if (s.parallel?.then === removed) {
          patched = {
            ...patched,
            parallel: s.parallel
              ? {
                  ...s.parallel,
                  then: removedNext || PIPELINE_GRAPH_END,
                }
              : null,
          };
        }
        return patched;
      });
    if (nextEntry !== entry) setEntry(nextEntry || "");
    emit(nextSteps);
    setSelectedId(null);
    setConfigOpen(false);
  }

  function runAutoLayout(nextSteps: EditablePipelineStep[] = steps, notify = true) {
    const layout = computeAutoLayout(nextSteps);
    setNodes(buildNodes(nextSteps, undefined, layout));
    setEdges(buildEdges(nextSteps, entry));
    window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 220 });
    }, 40);
    if (notify) message.success("已自动布局");
  }

  function openNodeConfig(id: string) {
    setSelectedId(id);
    setConfigOpen(true);
  }

  function onDragOverCanvas(event: React.DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDropCanvas(event: React.DragEvent) {
    event.preventDefault();
    const payload = parsePaletteDrag(event);
    if (!payload) return;
    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    addStepFromPalette(payload, {
      x: position.x - NODE_W / 2,
      y: position.y - 42,
    });
  }

  const onConnect: OnConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    const source = connection.source;
    const target = connection.target;
    const handle = connection.sourceHandle || "out";

    if (source === FLOW_END_ID) {
      message.info("结束节点不能向外连线");
      return;
    }
    if (target === FLOW_START_ID) {
      message.info("不能连回开始节点");
      return;
    }

    if (handle === "reject") {
      if (source === FLOW_START_ID) {
        message.info("开始节点没有驳回句柄");
        return;
      }
      if (target === FLOW_END_ID) {
        emit(
          steps.map((s) =>
            s.id === source
              ? { ...s, on_reject: "end" as const, reject_goto: undefined }
              : s,
          ),
        );
        return;
      }
      emit(
        steps.map((s) =>
          s.id === source
            ? {
                ...s,
                on_reject: "goto" as const,
                reject_goto: target,
              }
            : s,
        ),
      );
      return;
    }

    // Default flow handle (out)
    if (source === FLOW_START_ID) {
      if (target === FLOW_END_ID) {
        setEntry("");
        message.info("已断开开始入口");
        return;
      }
      setEntry(target);
      message.success("已连接：开始 → 入口步骤");
      return;
    }

    const sourceStep = steps.find((s) => s.id === source);
    const nextTo =
      target === FLOW_END_ID ? PIPELINE_GRAPH_END : target;

    // 条件网关：出边写入 branches（点边配条件）
    if (sourceStep && isConditionGateway(sourceStep)) {
      const existing = [...(sourceStep.branches || [])];
      const hit = existing.findIndex((b) => b.to === nextTo);
      if (hit >= 0) {
        message.info("该条件边已存在，点击紫色边可改条件");
        setSelectedEdgeId(`cond-${source}-${nextTo}-${hit}`);
        setSelectedEdge({ sourceId: source, branchIndex: hit });
        setConfigOpen(false);
        return;
      }
      const branch: PipelineStepBranch = {
        to: nextTo,
        label: existing.length === 0 ? "命中" : existing.length === 1 ? "默认" : "",
        when: defaultWhenForBranchIndex(existing.length),
      };
      emit(
        steps.map((s) =>
          s.id === source
            ? {
                ...s,
                next: null,
                parallel: null,
                branches: [...existing, branch],
              }
            : s,
        ),
      );
      setSelectedEdgeId(`cond-${source}-${nextTo}-${existing.length}`);
      setSelectedEdge({ sourceId: source, branchIndex: existing.length });
      setConfigOpen(false);
      message.success("已添加条件边，点击边可修改条件");
      return;
    }

    // 并行网关：出边写入 parallel.branches
    if (sourceStep && isParallelGateway(sourceStep)) {
      if (target === FLOW_END_ID) {
        message.info("请先连到支路步骤；汇合请从支路连出");
        return;
      }
      const branches = [...(sourceStep.parallel?.branches || [])];
      if (branches.includes(target)) {
        message.info("该并行支路已连接");
        return;
      }
      branches.push(target);
      const then = sourceStep.parallel?.then || "";
      const join = sourceStep.parallel?.join || "all";
      emit(
        steps.map((s) => {
          if (s.id === target) {
            return { ...s, human_approval: false, next: null };
          }
          if (s.id === source) {
            return {
              ...s,
              next: null,
              branches: undefined,
              parallel: { branches, join, then },
            };
          }
          return s;
        }),
      );
      pendingAutoLayout.current = true;
      message.success(
        branches.length < 2
          ? `已连接并行支路（还需 ${2 - branches.length} 条）`
          : "已连接并行支路",
      );
      return;
    }

    // 并行支路 → 汇合点
    const parent = findParallelParent(steps, source);
    if (parent?.parallel) {
      emit(
        steps.map((s) => {
          if (s.id === source) return { ...s, next: null };
          if (s.id === parent.id) {
            return {
              ...s,
              parallel: {
                ...parent.parallel!,
                then: nextTo,
              },
            };
          }
          return s;
        }),
      );
      message.success("已设置并行汇合点");
      return;
    }

    emit(
      steps.map((s) => (s.id === source ? { ...s, next: nextTo } : s)),
    );
  };

  return (
    <div className="pipeline-flow-editor">
      <div className="pipeline-flow-editor__toolbar">
        <Space wrap size={6}>
          <Tooltip title={paletteOpen ? "收起物料" : "展开物料"}>
            <Button
              size="small"
              type={paletteOpen ? "primary" : "default"}
              icon={<AppstoreOutlined />}
              onClick={() => setPaletteOpen((v) => !v)}
            >
              物料
            </Button>
          </Tooltip>
          <Button
            size="small"
            icon={<PartitionOutlined />}
            onClick={() => runAutoLayout()}
          >
            自动布局
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!selected || Boolean(selectedTerminal)}
            onClick={removeSelected}
          >
            删除选中
          </Button>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          拖物料落点放置 · 点击节点配置 · 点击边可选中
        </Typography.Text>
      </div>

      <div className="pipeline-flow-editor__body">
        <div
          className="pipeline-flow-canvas pipeline-flow-editor__canvas"
          style={{ height }}
          onDragOver={onDragOverCanvas}
          onDrop={onDropCanvas}
        >
          {paletteOpen ? (
            <div className="pipeline-flow-editor__float pipeline-flow-editor__float--palette">
              <PipelinePalette agentOptions={agentOptions} />
            </div>
          ) : null}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => {
              setSelectedEdgeId(null);
              setSelectedEdge(null);
              openNodeConfig(node.id);
            }}
            onNodeDoubleClick={(_, node) => {
              setSelectedEdgeId(null);
              setSelectedEdge(null);
              openNodeConfig(node.id);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedId(null);
              setConfigOpen(false);
              setSelectedEdgeId(edge.id);
              const data = edge.data as
                | { edgeKind?: string; sourceId?: string; branchIndex?: number }
                | undefined;
              if (
                data?.edgeKind === "cond" &&
                data.sourceId &&
                typeof data.branchIndex === "number"
              ) {
                setSelectedEdge({
                  sourceId: data.sourceId,
                  branchIndex: data.branchIndex,
                });
                return;
              }
              if (edge.id.startsWith("cond-")) {
                const src = edge.source;
                const step = steps.find((s) => s.id === src);
                const bi = (step?.branches || []).findIndex(
                  (b) =>
                    (b.to === PIPELINE_GRAPH_END
                      ? FLOW_END_ID
                      : b.to) === edge.target || b.to === edge.target,
                );
                if (bi >= 0) {
                  setSelectedEdge({ sourceId: src, branchIndex: bi });
                  return;
                }
              }
              setSelectedEdge(null);
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setSelectedEdgeId(null);
              setSelectedEdge(null);
              setConfigOpen(false);
            }}
            onNodesDelete={(deleted) => {
              if (
                deleted.some(
                  (n) => n.id === FLOW_START_ID || n.id === FLOW_END_ID,
                )
              ) {
                message.info("开始 / 结束节点不可删除");
                setNodes((prev) => buildNodes(steps, prev));
                setEdges(buildEdges(steps, entry));
              }
            }}
            onNodeDragStop={() => {
              const current = getNodes();
              const ordered = sortStepsByNodes(steps, current);
              const same =
                ordered.length === steps.length &&
                ordered.every((s, i) => s.id === steps[i]?.id);
              if (!same) emit(ordered);
              else setEdges(buildEdges(ordered, entry));
            }}
            onEdgesDelete={(deleted) => {
              let nextEntry = entry;
              let nextSteps = steps;
              let changed = false;
              for (const e of deleted) {
                if (e.id.startsWith("reject-")) {
                  nextSteps = nextSteps.map((s) =>
                    s.id === e.source
                      ? { ...s, on_reject: "end" as const, reject_goto: undefined }
                      : s,
                  );
                  changed = true;
                  continue;
                }
                if (e.source === FLOW_START_ID) {
                  nextEntry = "";
                  changed = true;
                  continue;
                }
                if (e.id.startsWith("cond-") || (e.data as { edgeKind?: string } | undefined)?.edgeKind === "cond") {
                  const data = e.data as
                    | { branchIndex?: number }
                    | undefined;
                  nextSteps = nextSteps.map((s) => {
                    if (s.id !== e.source) return s;
                    const branches = [...(s.branches || [])];
                    const idx =
                      typeof data?.branchIndex === "number"
                        ? data.branchIndex
                        : branches.findIndex(
                            (b) =>
                              b.to === e.target ||
                              (b.to === PIPELINE_GRAPH_END &&
                                e.target === FLOW_END_ID),
                          );
                    if (idx < 0) return s;
                    branches.splice(idx, 1);
                    return { ...s, branches };
                  });
                  changed = true;
                  continue;
                }
                if (e.id.startsWith("parallel-")) {
                  const branchId = e.target;
                  nextSteps = nextSteps.map((s) => {
                    if (s.id !== e.source || !s.parallel) return s;
                    const branches = (s.parallel.branches || []).filter(
                      (id) => id !== branchId,
                    );
                    return {
                      ...s,
                      parallel: { ...s.parallel, branches },
                    };
                  });
                  changed = true;
                  continue;
                }
                if (e.id.startsWith("join-")) {
                  const parent = findParallelParent(nextSteps, e.source);
                  if (parent) {
                    nextSteps = nextSteps.map((s) =>
                      s.id === parent.id && s.parallel
                        ? {
                            ...s,
                            parallel: { ...s.parallel, then: "" },
                          }
                        : s,
                    );
                    changed = true;
                  }
                  continue;
                }
                if (e.id.startsWith("seq-")) {
                  nextSteps = nextSteps.map((s) =>
                    s.id === e.source ? { ...s, next: null } : s,
                  );
                  changed = true;
                }
              }
              if (nextEntry !== entry) setEntry(nextEntry || "");
              if (changed) emit(nextSteps);
              setSelectedEdge(null);
            }}
            nodeTypes={nodeTypes}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            deleteKeyCode={["Backspace", "Delete"]}
            panOnScroll
            fitView
            proOptions={{ hideAttribution: true }}
            isValidConnection={(c) => {
              if (!c.source || !c.target || c.source === c.target) return false;
              if (c.target === FLOW_START_ID) return false;
              if (c.source === FLOW_END_ID) return false;
              const handle = c.sourceHandle || "out";
              if (handle === "reject") {
                return c.source !== FLOW_START_ID && c.source !== FLOW_END_ID;
              }
              // out → in (including 开始 → 步骤 / 步骤 → 结束)
              return handle === "out";
            }}
          >
            <Background gap={16} color="#eef1f6" />
            <Controls position="bottom-right" />
            <MiniMap
              pannable
              zoomable
              position="top-right"
              nodeStrokeWidth={2}
              style={{ height: 72, width: 110 }}
            />
          </ReactFlow>
        </div>
      </div>

      <Modal
        title={
          selectedTerminal
            ? selectedTerminal === FLOW_START_ID
              ? "开始节点"
              : "结束节点"
            : selected
              ? `配置 · ${selected.label || selected.id}`
              : "步骤配置"
        }
        open={configOpen && Boolean(selectedId)}
        onCancel={() => setConfigOpen(false)}
        footer={
          selected && !selectedTerminal ? (
            <Space>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={removeSelected}
              >
                删除步骤
              </Button>
              <Button type="primary" onClick={() => setConfigOpen(false)}>
                完成
              </Button>
            </Space>
          ) : (
            <Button type="primary" onClick={() => setConfigOpen(false)}>
              知道了
            </Button>
          )
        }
        width={520}
        destroyOnHidden
        className="pipeline-flow-config-modal"
        styles={{ body: { maxHeight: "min(68vh, 640px)", overflow: "auto" } }}
      >
        {selectedTerminal ? (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            固定流程节点，不可删除。可在画布上拖动调整位置；从物料面板拖入可重新定位。
          </Typography.Text>
        ) : selected ? (
            <Form layout="vertical" size="small" key={selected.id}>
              {(selected.kind || "agent") === "gateway" ? (
                <Typography.Paragraph
                  type="secondary"
                  style={{ fontSize: 12, marginBottom: 12 }}
                >
                  {isParallelGateway(selected)
                    ? "并行网关：从本节点连到各支路步骤，再从支路连到同一个汇合点。"
                    : "条件网关：从本节点拉多条出边；点击紫色条件边配置 when。"}
                </Typography.Paragraph>
              ) : null}
              <Form.Item label="步骤 ID" required>
                <Input
                  defaultValue={selected.id}
                  onBlur={(e) => {
                    const id = e.target.value.trim();
                    if (id && id !== selected.id) patchSelected({ id });
                  }}
                />
              </Form.Item>
              <Form.Item label="显示名">
                <Input
                  value={selected.label || ""}
                  onChange={(e) => patchSelected({ label: e.target.value })}
                />
              </Form.Item>
              <Form.Item label="步骤类型">
                <Select
                  value={selected.kind || "agent"}
                  options={[
                    { value: "agent", label: "Agent（Bridge 阶段）" },
                    { value: "gateway", label: "网关（条件/并行）" },
                    { value: "http", label: "HTTP 请求" },
                    { value: "wait_event", label: "等待事件" },
                    { value: "delay", label: "延时" },
                    { value: "ci", label: "CI 触发/轮询" },
                  ]}
                  onChange={(kind: PipelineStepKind) => {
                    if (kind === "agent") {
                      patchSelected({
                        kind,
                        human_approval: selected.human_approval,
                        http: null,
                        wait_event: null,
                        ci: null,
                        delay: null,
                        parallel: null,
                        agent:
                          selected.agent ||
                          agentOptions[0]?.value ||
                          "requirement",
                      });
                      return;
                    }
                    if (kind === "gateway") {
                      patchSelected({
                        kind,
                        agent: "",
                        human_approval: false,
                        http: null,
                        wait_event: null,
                        ci: null,
                        delay: null,
                        // 默认条件网关；可在下方切换为并行
                        parallel: null,
                        branches: selected.branches || [],
                        label: selected.label || "条件网关",
                      });
                      return;
                    }
                    patchSelected({
                      kind,
                      agent: "",
                      human_approval: false,
                      parallel: null,
                      http:
                        kind === "http"
                          ? selected.http || {
                              url: "",
                              method: "POST",
                              headers: {},
                              body: "",
                              success_statuses: [200, 201, 202, 204],
                              timeout_ms: 30_000,
                            }
                          : null,
                      wait_event:
                        kind === "wait_event"
                          ? selected.wait_event || {
                              event: "mr_merged",
                              labels: [],
                            }
                          : null,
                      ci:
                        kind === "ci"
                          ? selected.ci || {
                              trigger_url: "",
                              method: "POST",
                              headers: {},
                              body: "",
                              success_statuses: [200, 201, 202, 204],
                              timeout_ms: 30_000,
                              poll_url: "",
                              poll_interval_ms: 5_000,
                              poll_timeout_ms: 600_000,
                              success_includes: "success",
                              failure_includes: "failure",
                            }
                          : null,
                      delay:
                        kind === "delay"
                          ? selected.delay || { seconds: 60 }
                          : null,
                    });
                  }}
                />
              </Form.Item>
              {(selected.kind || "agent") === "gateway" ? (
                <Form.Item label="网关类型">
                  <Select
                    value={isParallelGateway(selected) ? "parallel" : "condition"}
                    options={[
                      { value: "condition", label: "条件网关" },
                      { value: "parallel", label: "并行网关" },
                    ]}
                    onChange={(mode: "condition" | "parallel") => {
                      if (mode === "parallel") {
                        patchSelected({
                          label:
                            selected.label === "条件网关"
                              ? "并行网关"
                              : selected.label,
                          branches: undefined,
                          parallel: {
                            branches: selected.parallel?.branches || [],
                            join: selected.parallel?.join || "all",
                            then: selected.parallel?.then || "",
                          },
                          next: null,
                        });
                        return;
                      }
                      patchSelected({
                        label:
                          selected.label === "并行网关"
                            ? "条件网关"
                            : selected.label,
                        parallel: null,
                        branches: selected.branches || [],
                        next: null,
                      });
                    }}
                  />
                </Form.Item>
              ) : null}
              {(selected.kind || "agent") === "agent" ? (
                <Form.Item label="数字人" required>
                  <Select
                    value={selected.agent}
                    options={agentOptions}
                    showSearch
                    optionFilterProp="label"
                    onChange={(agent) => patchSelected({ agent })}
                  />
                </Form.Item>
              ) : null}
              {(selected.kind || "agent") === "http" ? (
                <>
                  <Form.Item label="URL" required>
                    <Input
                      value={selected.http?.url || ""}
                      placeholder="https://…"
                      onChange={(e) =>
                        patchSelected({
                          http: {
                            ...(selected.http || {
                              method: "POST",
                              headers: {},
                              body: "",
                              success_statuses: [200, 201, 202, 204],
                              timeout_ms: 30_000,
                            }),
                            url: e.target.value,
                          },
                        })
                      }
                    />
                  </Form.Item>
                  <Form.Item label="Method">
                    <Select
                      value={selected.http?.method || "POST"}
                      options={["GET", "POST", "PUT", "PATCH", "DELETE"].map(
                        (m) => ({ value: m, label: m }),
                      )}
                      onChange={(method) =>
                        patchSelected({
                          http: {
                            ...(selected.http as PipelineHttpStep),
                            method,
                          },
                        })
                      }
                    />
                  </Form.Item>
                  <Form.Item
                    label="Body"
                    extra="可用 {{requirement}} {{title}} {{work_order_id}} {{run_id}}"
                  >
                    <Input.TextArea
                      rows={3}
                      value={selected.http?.body || ""}
                      onChange={(e) =>
                        patchSelected({
                          http: {
                            ...(selected.http as PipelineHttpStep),
                            body: e.target.value,
                          },
                        })
                      }
                    />
                  </Form.Item>
                </>
              ) : null}
              {(selected.kind || "agent") === "wait_event" ? (
                <>
                  <Form.Item label="等待事件" required>
                    <Select
                      value={selected.wait_event?.event || "mr_merged"}
                      options={[
                        { value: "mr_merged", label: "MR/PR 合并" },
                        { value: "issue_labeled", label: "Issue 打标签" },
                        { value: "manual", label: "任意 advance 事件" },
                      ]}
                      onChange={(event) =>
                        patchSelected({
                          wait_event: {
                            event,
                            labels: selected.wait_event?.labels || [],
                          },
                        })
                      }
                    />
                  </Form.Item>
                  {selected.wait_event?.event === "issue_labeled" ? (
                    <Form.Item label="标签（逗号分隔，空=任意）">
                      <Input
                        value={(selected.wait_event?.labels || []).join(", ")}
                        onChange={(e) =>
                          patchSelected({
                            wait_event: {
                              event: "issue_labeled",
                              labels: e.target.value
                                .split(",")
                                .map((x) => x.trim())
                                .filter(Boolean),
                            },
                          })
                        }
                      />
                    </Form.Item>
                  ) : null}
                </>
              ) : null}
              {(selected.kind || "agent") === "delay" ? (
                <Form.Item label="延时秒数" required>
                  <InputNumber
                    min={1}
                    max={86400 * 7}
                    style={{ width: "100%" }}
                    value={selected.delay?.seconds ?? 60}
                    onChange={(v) =>
                      patchSelected({
                        delay: { seconds: Math.max(1, Number(v) || 60) },
                      })
                    }
                  />
                </Form.Item>
              ) : null}
              {(selected.kind || "agent") === "ci" ? (
                <>
                  <Form.Item label="Trigger URL" required>
                    <Input
                      value={selected.ci?.trigger_url || ""}
                      onChange={(e) =>
                        patchSelected({
                          ci: {
                            ...(selected.ci as PipelineCiStep),
                            trigger_url: e.target.value,
                          },
                        })
                      }
                    />
                  </Form.Item>
                  <Form.Item label="Poll URL（可选）">
                    <Input
                      value={selected.ci?.poll_url || ""}
                      onChange={(e) =>
                        patchSelected({
                          ci: {
                            ...(selected.ci as PipelineCiStep),
                            poll_url: e.target.value,
                          },
                        })
                      }
                    />
                  </Form.Item>
                  <Form.Item label="成功包含">
                    <Input
                      value={selected.ci?.success_includes || "success"}
                      onChange={(e) =>
                        patchSelected({
                          ci: {
                            ...(selected.ci as PipelineCiStep),
                            success_includes: e.target.value,
                          },
                        })
                      }
                    />
                  </Form.Item>
                  <Form.Item label="轮询间隔 (ms)">
                    <InputNumber
                      style={{ width: "100%" }}
                      min={1000}
                      max={60_000}
                      value={selected.ci?.poll_interval_ms || 5_000}
                      onChange={(v) =>
                        patchSelected({
                          ci: {
                            ...(selected.ci as PipelineCiStep),
                            poll_interval_ms: Number(v) || 5_000,
                          },
                        })
                      }
                    />
                  </Form.Item>
                </>
              ) : null}
              {(selected.kind || "agent") === "agent" ? (
                <Form.Item label="人工确认">
                  <Switch
                    checked={selected.human_approval}
                    onChange={(human_approval) =>
                      patchSelected({ human_approval })
                    }
                  />
                </Form.Item>
              ) : null}
              <Form.Item label="驳回策略">
                <Select
                  value={selected.on_reject}
                  options={[
                    { value: "end", label: "结束" },
                    { value: "retry_step", label: "重试本步" },
                    { value: "goto", label: "跳转" },
                  ]}
                  onChange={(on_reject) => patchSelected({ on_reject })}
                />
              </Form.Item>
              {selected.on_reject === "goto" ? (
                <Form.Item label="跳转目标">
                  <Select
                    value={selected.reject_goto}
                    placeholder="选择步骤"
                    options={steps
                      .filter((s) => s.id !== selected.id)
                      .map((s) => ({
                        value: s.id,
                        label: s.label || s.id,
                      }))}
                    onChange={(reject_goto) =>
                      patchSelected({ on_reject: "goto", reject_goto })
                    }
                    allowClear
                  />
                </Form.Item>
              ) : null}
              <Form.Item
                label="并行支路（也可画布连线）"
                extra="从并行网关连到 ≥2 个步骤，再从支路连到汇合点；支路须关闭人工确认"
              >
                <Space direction="vertical" style={{ width: "100%" }} size={6}>
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="选择并行步骤"
                    value={selected.parallel?.branches || []}
                    options={steps
                      .filter((s) => s.id !== selected.id)
                      .map((s) => ({
                        value: s.id,
                        label: `${s.label || s.id}${s.human_approval ? "（需关人工确认）" : ""}`,
                      }))}
                    onChange={(branches: string[]) => {
                      if (!branches.length) {
                        patchSelected({ parallel: null });
                        return;
                      }
                      const others = steps.filter((s) => s.id !== selected.id);
                      const then =
                        selected.parallel?.then ||
                        others.find((s) => !branches.includes(s.id))?.id ||
                        PIPELINE_GRAPH_END;
                      const join = selected.parallel?.join || "all";
                      onChange?.(
                        steps.map((s) => {
                          if (branches.includes(s.id)) {
                            return { ...s, human_approval: false };
                          }
                          if (s.id === selected.id) {
                            return {
                              ...s,
                              branches: [],
                              parallel: { branches, join, then },
                            };
                          }
                          return s;
                        }),
                      );
                    }}
                  />
                  {(selected.parallel?.branches?.length || 0) >= 2 ? (
                    <>
                      <Select
                        value={selected.parallel?.join || "all"}
                        options={[
                          { value: "all", label: "全部完成再汇合" },
                          { value: "any", label: "任一完成即汇合" },
                        ]}
                        onChange={(join: "all" | "any") =>
                          patchSelected({
                            parallel: {
                              branches: selected.parallel!.branches,
                              join,
                              then: selected.parallel?.then || "",
                            },
                          })
                        }
                      />
                      <Select
                        value={selected.parallel?.then || PIPELINE_GRAPH_END}
                        placeholder="汇合后进入"
                        options={[
                          ...steps
                            .filter(
                              (s) =>
                                s.id !== selected.id &&
                                !(selected.parallel?.branches || []).includes(
                                  s.id,
                                ),
                            )
                            .map((s) => ({
                              value: s.id,
                              label: s.label || s.id,
                            })),
                          { value: PIPELINE_GRAPH_END, label: "结束 (__end__)" },
                        ]}
                        onChange={(then: string) =>
                          patchSelected({
                            parallel: {
                              branches: selected.parallel!.branches,
                              join: selected.parallel?.join || "all",
                              then,
                            },
                          })
                        }
                      />
                    </>
                  ) : null}
                </Space>
              </Form.Item>
              <Form.Item
                label="条件出边（也可点紫色边配置）"
                extra="优先从条件网关拉线；按顺序匹配，都不命中可再配线性下一步。与并行互斥。"
              >
                <Space direction="vertical" style={{ width: "100%" }} size={8}>
                  {(selected.branches || []).map((branch, idx) => (
                    <div
                      key={idx}
                      style={{
                        border: "1px solid #f0f0f0",
                        borderRadius: 6,
                        padding: 8,
                      }}
                    >
                      <Space direction="vertical" style={{ width: "100%" }} size={6}>
                        <Select
                          value={branch.when?.op || "feedback_includes"}
                          style={{ width: "100%" }}
                          options={[
                            { value: "feedback_includes", label: "审批反馈包含" },
                            { value: "feedback_matches", label: "审批反馈匹配正则" },
                            { value: "summary_includes", label: "阶段摘要包含" },
                            { value: "artifact_includes", label: "产物路径包含" },
                            { value: "default", label: "总是（兜底）" },
                          ]}
                          onChange={(op) => {
                            const branches = [...(selected.branches || [])];
                            const prevValue =
                              branch.when && "value" in branch.when
                                ? String(branch.when.value || "")
                                : "";
                            let when: PipelineCondition;
                            switch (op) {
                              case "default":
                                when = { op: "default" };
                                break;
                              case "feedback_matches":
                                when = { op: "feedback_matches", value: prevValue };
                                break;
                              case "summary_includes":
                                when = { op: "summary_includes", value: prevValue };
                                break;
                              case "artifact_includes":
                                when = { op: "artifact_includes", value: prevValue };
                                break;
                              case "feedback_includes":
                              default:
                                when = { op: "feedback_includes", value: prevValue };
                                break;
                            }
                            branches[idx] = { ...branch, when };
                            patchSelected({ branches });
                          }}
                        />
                        {branch.when?.op !== "default" ? (
                          <Input
                            placeholder="匹配值"
                            value={
                              branch.when && "value" in branch.when
                                ? branch.when.value
                                : ""
                            }
                            onChange={(e) => {
                              const branches = [...(selected.branches || [])];
                              const op = branch.when?.op || "feedback_includes";
                              let when: PipelineCondition;
                              switch (op) {
                                case "feedback_matches":
                                  when = {
                                    op: "feedback_matches",
                                    value: e.target.value,
                                  };
                                  break;
                                case "summary_includes":
                                  when = {
                                    op: "summary_includes",
                                    value: e.target.value,
                                  };
                                  break;
                                case "artifact_includes":
                                  when = {
                                    op: "artifact_includes",
                                    value: e.target.value,
                                  };
                                  break;
                                case "feedback_includes":
                                default:
                                  when = {
                                    op: "feedback_includes",
                                    value: e.target.value,
                                  };
                                  break;
                              }
                              branches[idx] = { ...branch, when };
                              patchSelected({ branches });
                            }}
                          />
                        ) : null}
                        <Select
                          value={branch.to || undefined}
                          placeholder="跳转到"
                          style={{ width: "100%" }}
                          options={[
                            ...steps
                              .filter((s) => s.id !== selected.id)
                              .map((s) => ({
                                value: s.id,
                                label: s.label || s.id,
                              })),
                            { value: PIPELINE_GRAPH_END, label: "结束 (__end__)" },
                          ]}
                          onChange={(to) => {
                            const branches = [...(selected.branches || [])];
                            branches[idx] = { ...branch, to };
                            patchSelected({ branches });
                          }}
                        />
                        <Input
                          placeholder="边标签（可选）"
                          value={branch.label || ""}
                          onChange={(e) => {
                            const branches = [...(selected.branches || [])];
                            branches[idx] = { ...branch, label: e.target.value };
                            patchSelected({ branches });
                          }}
                        />
                        <Button
                          size="small"
                          danger
                          type="link"
                          onClick={() => {
                            const branches = (selected.branches || []).filter(
                              (_, i) => i !== idx,
                            );
                            patchSelected({ branches });
                          }}
                        >
                          删除分支
                        </Button>
                      </Space>
                    </div>
                  ))}
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    disabled={Boolean(selected.parallel?.branches?.length)}
                    onClick={() => {
                      const others = steps.filter((s) => s.id !== selected.id);
                      const seed = defaultBranch();
                      seed.to = others[0]?.id || PIPELINE_GRAPH_END;
                      patchSelected({
                        parallel: null,
                        branches: [...(selected.branches || []), seed],
                      });
                    }}
                  >
                    添加条件分支
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          ) : (
            <Typography.Text type="secondary">未选中步骤</Typography.Text>
          )}
      </Modal>

      <Modal
        title="配置条件边"
        open={Boolean(selectedEdge)}
        onCancel={() => setSelectedEdge(null)}
        footer={
          <Space>
            <Button
              danger
              onClick={() => {
                if (!selectedEdge) return;
                emit(
                  steps.map((s) => {
                    if (s.id !== selectedEdge.sourceId) return s;
                    const branches = [...(s.branches || [])];
                    branches.splice(selectedEdge.branchIndex, 1);
                    return { ...s, branches };
                  }),
                );
                setSelectedEdge(null);
              }}
            >
              删除此边
            </Button>
            <Button type="primary" onClick={() => setSelectedEdge(null)}>
              完成
            </Button>
          </Space>
        }
        width={440}
        destroyOnHidden
      >
        {selectedEdge ? (
          (() => {
            const gw = steps.find((s) => s.id === selectedEdge.sourceId);
            const branch = gw?.branches?.[selectedEdge.branchIndex];
            if (!gw || !branch) {
              return (
                <Typography.Text type="secondary">边已不存在</Typography.Text>
              );
            }
            const patchBranch = (patch: Partial<PipelineStepBranch>) => {
              emit(
                steps.map((s) => {
                  if (s.id !== gw.id) return s;
                  const branches = [...(s.branches || [])];
                  branches[selectedEdge.branchIndex] = {
                    ...branches[selectedEdge.branchIndex]!,
                    ...patch,
                  };
                  return { ...s, branches };
                }),
              );
            };
            return (
              <Form layout="vertical" size="small">
                <Form.Item label="来源">{gw.label || gw.id}</Form.Item>
                <Form.Item label="目标">
                  <Select
                    value={branch.to}
                    options={[
                      ...steps
                        .filter((s) => s.id !== gw.id)
                        .map((s) => ({
                          value: s.id,
                          label: s.label || s.id,
                        })),
                      { value: PIPELINE_GRAPH_END, label: "结束 (__end__)" },
                    ]}
                    onChange={(to) => patchBranch({ to })}
                  />
                </Form.Item>
                <Form.Item label="条件">
                  <Select
                    value={branch.when?.op || "default"}
                    options={[
                      { value: "default", label: "默认（兜底）" },
                      {
                        value: "feedback_includes",
                        label: "反馈包含…",
                      },
                      {
                        value: "feedback_matches",
                        label: "反馈匹配正则",
                      },
                      {
                        value: "summary_includes",
                        label: "摘要包含…",
                      },
                      {
                        value: "artifact_includes",
                        label: "产物包含…",
                      },
                    ]}
                    onChange={(op) => {
                      if (op === "default") {
                        patchBranch({ when: { op: "default" } });
                        return;
                      }
                      const value =
                        branch.when && "value" in branch.when
                          ? branch.when.value
                          : "";
                      patchBranch({
                        when: { op, value } as PipelineCondition,
                      });
                    }}
                  />
                </Form.Item>
                {branch.when &&
                branch.when.op !== "default" &&
                "value" in branch.when ? (
                  <Form.Item label="匹配值">
                    <Input
                      value={branch.when.value}
                      onChange={(e) =>
                        patchBranch({
                          when: {
                            ...(branch.when as Extract<
                              PipelineCondition,
                              { value: string }
                            >),
                            value: e.target.value,
                          },
                        })
                      }
                    />
                  </Form.Item>
                ) : null}
                <Form.Item label="边标签">
                  <Input
                    value={branch.label || ""}
                    placeholder="可选"
                    onChange={(e) => patchBranch({ label: e.target.value })}
                  />
                </Form.Item>
              </Form>
            );
          })()
        ) : null}
      </Modal>
    </div>
  );
}

export function PipelineFlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorCanvas {...props} />
    </ReactFlowProvider>
  );
}
