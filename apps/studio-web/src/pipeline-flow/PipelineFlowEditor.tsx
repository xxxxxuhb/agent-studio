import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
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
  Select,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
  NODE_W,
  type PipelineFlowNodeData,
} from "./buildPipelineFlow";
import { PipelineStepNode } from "./PipelineStepNode";

export type EditablePipelineStep = {
  id: string;
  agent: string;
  label?: string;
  human_approval: boolean;
  on_reject: "end" | "retry_step" | "goto";
  reject_goto?: string;
};

type AgentOption = { value: string; label: string };

type Props = {
  value?: EditablePipelineStep[];
  onChange?: (next: EditablePipelineStep[]) => void;
  agentOptions: AgentOption[];
  height?: number | string;
};

const nodeTypes: NodeTypes = {
  pipelineStep: PipelineStepNode,
};

const GAP_X = 56;
const START_X = 32;
const START_Y = 72;

function nextStepId(steps: EditablePipelineStep[]): string {
  let n = steps.length + 1;
  const used = new Set(steps.map((s) => s.id));
  while (used.has(`step_${n}`)) n += 1;
  return `step_${n}`;
}

function buildNodes(
  steps: EditablePipelineStep[],
  prev?: Node<PipelineFlowNodeData>[],
): Node<PipelineFlowNodeData>[] {
  const pos = new Map(prev?.map((n) => [n.id, n.position]));
  return steps.map((s, i) => ({
    id: s.id,
    type: "pipelineStep",
    position: pos.get(s.id) ?? {
      x: START_X + i * (NODE_W + GAP_X),
      y: START_Y,
    },
    data: {
      label: s.label || s.id,
      agent: s.agent,
      humanApproval: Boolean(s.human_approval),
      phase: "idle",
      statusText: s.human_approval ? "需人工确认" : "自动推进",
      index: i + 1,
      editable: true,
    },
  }));
}

function buildEdges(steps: EditablePipelineStep[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i]!;
    const to = steps[i + 1]!;
    edges.push({
      id: `seq-${from.id}-${to.id}`,
      source: from.id,
      target: to.id,
      sourceHandle: "out",
      targetHandle: "in",
      type: "smoothstep",
      deletable: false,
      selectable: false,
      label: "下一步",
      style: { stroke: "#91caff", strokeWidth: 2 },
      labelStyle: { fontSize: 11, fill: "#8c8c8c" },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#91caff" },
    });
  }
  for (const s of steps) {
    if (s.on_reject === "goto" && s.reject_goto && steps.some((x) => x.id === s.reject_goto)) {
      edges.push({
        id: `reject-${s.id}-${s.reject_goto}`,
        source: s.id,
        target: s.reject_goto,
        sourceHandle: "reject",
        targetHandle: "in",
        type: "smoothstep",
        label: "驳回跳转",
        style: { stroke: "#ff7875", strokeWidth: 1.5, strokeDasharray: "6 4" },
        labelStyle: { fontSize: 11, fill: "#cf1322" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#ff7875" },
      });
    }
  }
  return edges;
}

function sortStepsByNodes(
  steps: EditablePipelineStep[],
  nodes: Node[],
): EditablePipelineStep[] {
  const order = [...nodes]
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
    .map((n) => n.id);
  const map = new Map(steps.map((s) => [s.id, s]));
  return order.map((id) => map.get(id)!).filter(Boolean);
}

function EditorCanvas({ value = [], onChange, agentOptions, height = 420 }: Props) {
  const steps = value;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PipelineFlowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, getNodes } = useReactFlow();

  const stepIdsKey = useMemo(
    () =>
      steps
        .map(
          (s) =>
            `${s.id}|${s.agent}|${s.label || ""}|${s.human_approval}|${s.on_reject}|${s.reject_goto || ""}`,
        )
        .join(";"),
    [steps],
  );
  const idOrderKey = useMemo(() => steps.map((s) => s.id).join(","), [steps]);

  useEffect(() => {
    setNodes((prev) => buildNodes(steps, prev));
    setEdges(buildEdges(steps));
    if (!selectedId || !steps.some((s) => s.id === selectedId)) {
      setSelectedId(steps[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdsKey]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void fitView({ padding: 0.18, duration: 180 });
    }, 40);
    return () => window.clearTimeout(t);
  }, [idOrderKey, fitView]);

  const selected = steps.find((s) => s.id === selectedId) || null;

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

  function addStep() {
    const id = nextStepId(steps);
    emit([
      ...steps,
      {
        id,
        agent: agentOptions[0]?.value || "requirement",
        label: `步骤 ${steps.length + 1}`,
        human_approval: true,
        on_reject: "end",
      },
    ]);
    setSelectedId(id);
  }

  function removeSelected() {
    if (!selected) return;
    if (steps.length <= 1) {
      message.warning("至少保留一个步骤");
      return;
    }
    emit(
      steps
        .filter((s) => s.id !== selected.id)
        .map((s) =>
          s.reject_goto === selected.id
            ? { ...s, on_reject: "end" as const, reject_goto: undefined }
            : s,
        ),
    );
    setSelectedId(null);
  }

  const onConnect: OnConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    if (connection.sourceHandle !== "reject") {
      message.info("请从节点底部红色句柄拖出驳回跳转线");
      return;
    }
    emit(
      steps.map((s) =>
        s.id === connection.source
          ? {
              ...s,
              on_reject: "goto" as const,
              reject_goto: connection.target!,
            }
          : s,
      ),
    );
    setEdges((eds) =>
      addEdge(
        {
          ...connection,
          id: `reject-${connection.source}-${connection.target}`,
          type: "smoothstep",
          label: "驳回跳转",
          style: { stroke: "#ff7875", strokeWidth: 1.5, strokeDasharray: "6 4" },
        },
        eds.filter((e) => !(e.id.startsWith("reject-") && e.source === connection.source)),
      ),
    );
  };

  return (
    <div className="pipeline-flow-editor">
      <div className="pipeline-flow-editor__toolbar">
        <Space wrap>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={addStep}>
            添加步骤
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!selected || steps.length <= 1}
            onClick={removeSelected}
          >
            删除选中
          </Button>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          左右拖拽调整执行顺序 · 从底部红点连线设置驳回跳转
        </Typography.Text>
      </div>

      <div className="pipeline-flow-editor__body">
        <div className="pipeline-flow-canvas pipeline-flow-editor__canvas" style={{ height }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            onNodeDragStop={() => {
              const current = getNodes();
              const ordered = sortStepsByNodes(steps, current);
              const same =
                ordered.length === steps.length &&
                ordered.every((s, i) => s.id === steps[i]?.id);
              if (!same) emit(ordered);
              else setEdges(buildEdges(ordered));
            }}
            onEdgesDelete={(deleted) => {
              const rejectSources = deleted
                .filter((e) => e.id.startsWith("reject-"))
                .map((e) => e.source);
              if (!rejectSources.length) return;
              emit(
                steps.map((s) =>
                  rejectSources.includes(s.id)
                    ? { ...s, on_reject: "end" as const, reject_goto: undefined }
                    : s,
                ),
              );
            }}
            nodeTypes={nodeTypes}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            deleteKeyCode={["Backspace", "Delete"]}
            panOnScroll
            fitView
            proOptions={{ hideAttribution: true }}
            isValidConnection={(c) =>
              Boolean(c.source && c.target && c.source !== c.target && c.sourceHandle === "reject")
            }
          >
            <Background gap={16} color="#eef1f6" />
            <Controls />
            <MiniMap pannable zoomable nodeStrokeWidth={2} style={{ height: 72, width: 110 }} />
          </ReactFlow>
        </div>

        <aside className="pipeline-flow-editor__inspector">
          {selected ? (
            <Form layout="vertical" size="small" key={selected.id}>
              <Typography.Text strong style={{ display: "block", marginBottom: 10 }}>
                步骤属性
              </Typography.Text>
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
              <Form.Item label="数字人" required>
                <Select
                  value={selected.agent}
                  options={agentOptions}
                  showSearch
                  optionFilterProp="label"
                  onChange={(agent) => patchSelected({ agent })}
                />
              </Form.Item>
              <Form.Item label="人工确认">
                <Switch
                  checked={selected.human_approval}
                  onChange={(human_approval) => patchSelected({ human_approval })}
                />
              </Form.Item>
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
            </Form>
          ) : (
            <div className="pipeline-flow-editor__inspector-empty">
              选中画布中的步骤以编辑属性
            </div>
          )}
        </aside>
      </div>
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
