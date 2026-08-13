import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export type TerminalKind = "start" | "end";

export type PipelineTerminalNodeData = {
  kind: TerminalKind;
  label: string;
};

type TerminalFlowNode = Node<PipelineTerminalNodeData, "pipelineTerminal">;

export function PipelineTerminalNode({ data }: NodeProps<TerminalFlowNode>) {
  const isStart = data.kind === "start";
  return (
    <div
      className={`pipeline-flow-terminal pipeline-flow-terminal--${data.kind}`}
      title={data.label}
    >
      {!isStart ? (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id="in"
            className="pipeline-flow-handle"
          />
          <Handle
            type="target"
            position={Position.Bottom}
            id="reject-in"
            className="pipeline-flow-handle pipeline-flow-handle--reject"
          />
        </>
      ) : null}
      <span className="pipeline-flow-terminal__label">{data.label}</span>
      {isStart ? (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          className="pipeline-flow-handle"
        />
      ) : null}
    </div>
  );
}
