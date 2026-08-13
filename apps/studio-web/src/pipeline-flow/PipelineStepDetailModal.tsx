import { Descriptions, Empty, Modal, Space, Tag, Typography } from "antd";
import type { WorkOrderRunEvent, WorkOrderRunStep } from "@agent-studio/agent-schema";
import { AgentOutputView } from "../components/AgentOutputView";
import { LiveEventMessage } from "../components/LiveEventMessage";
import { MarkdownBody } from "../components/MarkdownBody";
import { STEP_STATUS_LABEL } from "../work-orders/workOrderLabels";

type Props = {
  open: boolean;
  onClose: () => void;
  step: WorkOrderRunStep | null;
  /** Timeline events related to this step (optional). */
  events?: WorkOrderRunEvent[];
  onOpenDoc?: (path: string) => void;
};

function formatTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Normalize Bridge/agent blurb into Markdown-friendly text. */
function formatSummaryMarkdown(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  // Turn lone "**Title** rest" lines into proper paragraphs
  text = text.replace(/\n{3,}/g, "\n\n");
  // Ensure list-like " - " after bold headers get newlines
  text = text.replace(/([^\n])\s+-\s+/g, "$1\n- ");
  return text;
}

export function PipelineStepDetailModal({
  open,
  onClose,
  step,
  events = [],
  onOpenDoc,
}: Props) {
  const status = step
    ? STEP_STATUS_LABEL[step.status] || { color: "default", text: step.status }
    : null;

  return (
    <Modal
      title={
        step
          ? `步骤详情 · ${step.label || step.step_id}`
          : "步骤详情"
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(960px, 94vw)"
      style={{ top: 24 }}
      destroyOnHidden
      className="pipeline-step-detail-modal"
      zIndex={1100}
      styles={{
        body: {
          maxHeight: "calc(100vh - 110px)",
          overflowY: "auto",
          paddingTop: 12,
        },
      }}
    >
      {!step ? (
        <Empty description="未选中步骤" />
      ) : (
        <div className="pipeline-step-detail">
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2 }}
            bordered
            className="pipeline-step-detail__meta"
          >
            <Descriptions.Item label="步骤 ID">{step.step_id}</Descriptions.Item>
            <Descriptions.Item label="数字人">@{step.agent}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={status?.color}>{status?.text || step.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="人工确认">
              {step.human_approval ? "是" : "否"}
            </Descriptions.Item>
            <Descriptions.Item label="驳回策略">
              {step.on_reject}
              {step.on_reject === "goto" && step.reject_goto
                ? ` → ${step.reject_goto}`
                : ""}
            </Descriptions.Item>
            <Descriptions.Item label="时间">
              {formatTime(step.started_at)} → {formatTime(step.finished_at)}
            </Descriptions.Item>
          </Descriptions>

          {step.summary?.trim() ? (
            <section className="pipeline-step-detail__section">
              <Typography.Title level={5}>摘要</Typography.Title>
              <div className="pipeline-step-detail__card">
                <MarkdownBody
                  content={formatSummaryMarkdown(step.summary)}
                  className="pipeline-step-detail__summary"
                />
              </div>
            </section>
          ) : null}

          {step.feedback?.trim() ? (
            <section className="pipeline-step-detail__section">
              <Typography.Title level={5}>人工反馈</Typography.Title>
              <div className="pipeline-step-detail__card">
                {onOpenDoc ? (
                  <LiveEventMessage
                    message={step.feedback}
                    onOpenDoc={onOpenDoc}
                  />
                ) : (
                  <MarkdownBody content={step.feedback} />
                )}
              </div>
            </section>
          ) : null}

          <section className="pipeline-step-detail__section">
            <Typography.Title level={5}>
              {step.output_title || "步骤产出"}
            </Typography.Title>
            {step.output?.trim() ? (
              <div className="pipeline-step-detail__card">
                <AgentOutputView output={step.output} maxHeight={null} />
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="该步骤尚无产出内容"
              />
            )}
          </section>

          {events.length ? (
            <section className="pipeline-step-detail__section">
              <Typography.Title level={5}>相关动态</Typography.Title>
              <div className="pipeline-step-detail-events">
                {events.map((e, idx) => (
                  <div
                    className="pipeline-step-detail-event"
                    key={e.id || `${e.at}-${idx}`}
                  >
                    <Space wrap size={4} style={{ marginBottom: 4 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatTime(e.at)}
                      </Typography.Text>
                      <Tag>{e.type}</Tag>
                      {e.bridge_stage ? (
                        <Tag color="green">{e.bridge_stage}</Tag>
                      ) : null}
                    </Space>
                    {onOpenDoc ? (
                      <LiveEventMessage message={e.message} onOpenDoc={onOpenDoc} />
                    ) : (
                      <MarkdownBody content={e.message} />
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/** Events that belong to a step (by step_id / agent / message mention). */
export function eventsForStep(
  events: WorkOrderRunEvent[] | undefined,
  step: WorkOrderRunStep,
): WorkOrderRunEvent[] {
  if (!events?.length) return [];
  return events.filter((e) => {
    if (e.step_id && e.step_id === step.step_id) return true;
    if (e.agent && e.agent === step.agent && !e.step_id) return true;
    return false;
  });
}
