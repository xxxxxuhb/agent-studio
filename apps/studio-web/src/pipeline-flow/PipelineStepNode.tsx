import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Tag } from "antd";
import type { PipelineFlowNodeData } from "./buildPipelineFlow";

const PHASE_STYLE: Record<
  PipelineFlowNodeData["phase"],
  { border: string; bg: string; accent: string; tag: string }
> = {
  idle: { border: "#d9d9d9", bg: "#fff", accent: "#1677ff", tag: "default" },
  pending: { border: "#d9d9d9", bg: "#fafafa", accent: "#8c8c8c", tag: "default" },
  running: { border: "#1677ff", bg: "#e6f4ff", accent: "#1677ff", tag: "processing" },
  done: { border: "#52c41a", bg: "#f6ffed", accent: "#52c41a", tag: "success" },
  failed: { border: "#ff4d4f", bg: "#fff2f0", accent: "#ff4d4f", tag: "error" },
};

const KIND_ACCENT: Record<
  NonNullable<PipelineFlowNodeData["stepKind"]>,
  string
> = {
  agent: "#1677ff",
  http: "#722ed1",
  wait_event: "#13c2c2",
  ci: "#2f54eb",
  delay: "#597ef7",
  gateway: "#fa8c16",
};

type PipelineStepFlowNode = Node<PipelineFlowNodeData, "pipelineStep">;

export function PipelineStepNode({ data, selected }: NodeProps<PipelineStepFlowNode>) {
  const skin = PHASE_STYLE[data.phase] || PHASE_STYLE.idle;
  const kind = data.stepKind || "agent";
  const accent =
    data.phase === "idle" || data.phase === "pending"
      ? KIND_ACCENT[kind] || skin.accent
      : skin.accent;
  const editable = Boolean(data.editable);
  const clickable = Boolean(data.clickable);
  const showReject = Boolean(data.showRejectHandle || editable);
  const kindTags = data.kindTags?.length
    ? data.kindTags
    : data.humanApproval
      ? [{ text: "人工确认", color: "warning" }]
      : [{ text: "自动推进", color: "blue" }];
  const subtitle = data.subtitle || (data.agent ? `@${data.agent}` : "");

  return (
    <div
      className={`pipeline-flow-node pipeline-flow-node--${data.phase} pipeline-flow-node--kind-${kind}${selected ? " is-selected" : ""}${editable ? " is-editable" : ""}${clickable ? " is-clickable" : ""}`}
      style={{
        borderColor: selected ? accent : skin.border,
        background: skin.bg,
        boxShadow: selected
          ? `0 0 0 3px ${accent}33`
          : data.phase === "running"
            ? "0 0 0 3px rgba(22, 119, 255, 0.15)"
            : "0 2px 8px rgba(15, 23, 42, 0.06)",
        cursor: clickable ? "pointer" : editable ? "grab" : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="pipeline-flow-handle"
      />
      <div className="pipeline-flow-node__idx" style={{ background: accent }}>
        {data.index}
      </div>
      <div className="pipeline-flow-node__body">
        <div className="pipeline-flow-node__title" title={data.label}>
          {data.label}
        </div>
        {subtitle ? (
          <div className="pipeline-flow-node__agent" title={subtitle}>
            {subtitle}
          </div>
        ) : null}
        <div className="pipeline-flow-node__meta">
          {data.phase !== "idle" ? (
            <Tag color={skin.tag} style={{ margin: 0 }}>
              {data.statusText}
            </Tag>
          ) : null}
          {kindTags.map((t) => (
            <Tag key={t.text} color={t.color || "default"} style={{ margin: 0 }}>
              {t.text}
            </Tag>
          ))}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="pipeline-flow-handle"
      />
      {showReject ? (
        <Handle
          type="source"
          position={Position.Bottom}
          id="reject"
          className="pipeline-flow-handle pipeline-flow-handle--reject"
          title="驳回"
        />
      ) : null}
    </div>
  );
}
