import { Collapse, Space, Tag, Typography } from "antd";
import { MarkdownBody } from "./MarkdownBody";
import { parseAgentOutput } from "../work-orders/parseAgentOutput";

type Props = {
  output: string;
  /** Cap height for scrollable panels */
  maxHeight?: number;
};

const STATUS_COLOR: Record<string, string> = {
  ok: "success",
  success: "success",
  passed: "success",
  pass: "success",
  failed: "error",
  error: "error",
  running: "processing",
  paused: "warning",
};

/**
 * Beautified agent step output.
 * Handles Bridge JSON ({ runId, stage, status, summary }) and plain Markdown / text.
 */
export function AgentOutputView({ output, maxHeight = 420 }: Props) {
  const parsed = parseAgentOutput(output);

  if (!parsed.body && parsed.kind !== "structured") {
    return <Typography.Text type="secondary">（空产出）</Typography.Text>;
  }

  if (parsed.kind === "structured") {
    const status = parsed.meta.status || parsed.meta.Status;
    return (
      <div className="agent-output" style={{ maxHeight, overflow: "auto" }}>
        <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
          {parsed.meta.runId || parsed.meta.run_id ? (
            <Tag color="blue">run {parsed.meta.runId || parsed.meta.run_id}</Tag>
          ) : null}
          {parsed.meta.stage ? <Tag>{parsed.meta.stage}</Tag> : null}
          {status ? (
            <Tag color={STATUS_COLOR[status.toLowerCase()] || "default"}>{status}</Tag>
          ) : null}
          {parsed.meta.agent ? <Tag>{parsed.meta.agent}</Tag> : null}
          {Object.entries(parsed.meta)
            .filter(
              ([k]) =>
                !["runId", "run_id", "stage", "status", "Status", "agent"].includes(k),
            )
            .map(([k, v]) => (
              <Tag key={k}>
                {k}: {v}
              </Tag>
            ))}
        </Space>
        {parsed.body ? <MarkdownBody content={parsed.body} /> : null}
        {parsed.restJson ? (
          <Collapse
            style={{ marginTop: 12 }}
            items={[
              {
                key: "rest",
                label: "其他字段",
                children: <pre className="agent-output-pre">{parsed.restJson}</pre>,
              },
            ]}
          />
        ) : null}
      </div>
    );
  }

  if (parsed.kind === "markdown") {
    return (
      <div className="agent-output" style={{ maxHeight, overflow: "auto" }}>
        <MarkdownBody content={parsed.body} />
      </div>
    );
  }

  if (parsed.kind === "json") {
    return (
      <pre className="agent-output-pre" style={{ maxHeight, overflow: "auto" }}>
        {parsed.pretty}
      </pre>
    );
  }

  return (
    <pre className="agent-output-pre" style={{ maxHeight, overflow: "auto" }}>
      {parsed.body}
    </pre>
  );
}
