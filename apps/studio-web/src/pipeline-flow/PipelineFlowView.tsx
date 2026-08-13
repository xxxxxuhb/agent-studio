import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  buildPipelineFlowGraph,
  type FlowStepInput,
} from "./buildPipelineFlow";
import { PipelineStepNode } from "./PipelineStepNode";
import { PipelineTerminalNode } from "./PipelineTerminalNode";

const nodeTypes: NodeTypes = {
  pipelineStep: PipelineStepNode,
  pipelineTerminal: PipelineTerminalNode,
};

type Props = {
  steps: FlowStepInput[];
  withStatus?: boolean;
  height?: number | string;
  className?: string;
  showMiniMap?: boolean;
  /** Enable node click; cursor pointer. */
  onNodeClick?: (stepId: string) => void;
};

function FlowCanvas({
  steps,
  withStatus,
  height = 280,
  className,
  showMiniMap = true,
  onNodeClick,
}: Props) {
  const clickable = Boolean(onNodeClick);
  const graph = useMemo(
    () => buildPipelineFlowGraph(steps, { withStatus, clickable }),
    [steps, withStatus, clickable],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
    const t = window.setTimeout(() => {
      void fitView({ padding: 0.28, duration: 200, minZoom: 0.35, maxZoom: 1.2 });
    }, 40);
    return () => window.clearTimeout(t);
  }, [graph, setNodes, setEdges, fitView]);

  if (!steps.length) {
    return (
      <div className="pipeline-flow-empty" style={{ height }}>
        暂无步骤
      </div>
    );
  }

  return (
    <div className={`pipeline-flow-canvas ${className || ""}`} style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={
          onNodeClick
            ? (_evt, node) => {
                if (node.type === "pipelineTerminal") return;
                onNodeClick(node.id);
              }
            : undefined
        }
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={clickable}
        panOnScroll
        zoomOnScroll
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color="#f0f0f0" />
        <Controls showInteractive={false} />
        {showMiniMap ? (
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={2}
            style={{ height: 80, width: 120 }}
          />
        ) : null}
      </ReactFlow>
    </div>
  );
}

export function PipelineFlowView(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
}
