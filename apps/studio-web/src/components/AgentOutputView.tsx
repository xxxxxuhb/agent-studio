import { Collapse, Space, Tag, Typography } from "antd";
import { MarkdownBody } from "./MarkdownBody";
import { parseAgentOutput } from "../work-orders/parseAgentOutput";

type Props = {
  output: string;
  /**
   * Cap height for scrollable panels.
   * Omit for default 420; pass `null` for unconstrained (parent scrolls).
   */
  maxHeight?: number | string | null;
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
export function AgentOutputView({ output, maxHeight }: Props) {
  const parsed = parseAgentOutput(output);
  const boxStyle =
    maxHeight === null
      ? undefined
      : { maxHeight: maxHeight ?? 420, overflow: "auto" as const };

  if (!parsed.body && parsed.kind !== "structured") {
    return <Typography.Text type="secondary">（空产出）</Typography.Text>;
  }

  if (parsed.kind === "structured") {
    const status = parsed.meta.status || parsed.meta.Status;
    return (
      <div className="agent-output" style={boxStyle}>
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
      <div className="agent-output" style={boxStyle}>
        <MarkdownBody content={parsed.body} />
      </div>
    );
  }

  if (parsed.kind === "json") {
    return (
      <pre className="agent-output-pre" style={boxStyle}>
        {parsed.pretty}
      </pre>
    );
  }

  return (
    <pre className="agent-output-pre" style={boxStyle}>
      {parsed.body}
    </pre>
  );
}
