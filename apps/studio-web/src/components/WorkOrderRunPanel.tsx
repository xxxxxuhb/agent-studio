import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Drawer,
  Empty,
  Input,
  Modal,
  Space,
  Steps,
  Tag,
  Typography,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  CommentOutlined,
  ExpandOutlined,
  ProfileOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import type { WorkOrder, WorkOrderRunStep } from "@agent-studio/agent-schema";
import { AgentOutputView } from "./AgentOutputView";
import { RunArtifactsPanel } from "./RunArtifactsPanel";
import {
  ClarificationChecklist,
  hasOpenQuestions,
} from "./ClarificationChecklist";
import { MarkdownBody } from "./MarkdownBody";
import { WorkOrderAgentChat } from "./WorkOrderAgentChat";
import {
  STATUS_LABEL,
  STEP_STATUS_LABEL,
  STEP_STATUS_MAP,
} from "../work-orders/workOrderLabels";

type Props = {
  order: WorkOrder;
  feedback: string;
  onFeedbackChange: (value: string) => void;
  onDecide: (
    decision: "approve" | "reject",
    action?: string,
    feedbackOverride?: string,
  ) => void;
  onRestart?: () => void;
  onOrderUpdate?: (order: WorkOrder) => void;
};

type RunAlertInfo = {
  type: "success" | "info" | "warning" | "error";
  message: string;
  hint: string;
  offerRestart?: boolean;
};

function formatEventTime(at: string): string {
  try {
    return new Date(at).toLocaleTimeString();
  } catch {
    return at;
  }
}

/** Kept for leftover non-studio / legacy run.dify payloads. */
export function describeLegacyRunAlert(
  order: WorkOrder,
  dify: NonNullable<NonNullable<WorkOrder["run"]>["dify"]>,
): RunAlertInfo {
  const err = (dify.error || "").trim();
  const summary = (dify.raw_summary || "").trim();
  const softHeld = order.status === "running" && Boolean(err);
  const syncFailed =
    softHeld &&
    (err.startsWith("同步失败:") ||
      /拉取.*状态失败|get run failed|get run/i.test(summary || err));
  const transientBridge =
    /\b(502|503|504)\b|bridge_busy|econnrefused|fetch failed|不可达|掉线|瞬时/i.test(
      `${err}\n${summary}`,
    );

  if (syncFailed) {
    return {
      type: "warning",
      message: "运行状态同步失败（可重试）",
      hint: "拉取运行状态失败；可点「重新执行」开新一轮。",
      offerRestart: true,
    };
  }
  if (dify.status === "failed" || order.status === "failed") {
    return {
      type: transientBridge ? "warning" : "error",
      message: transientBridge
        ? "编排失败（疑似 Bridge/网络瞬时）"
        : "编排失败",
      hint: transientBridge
        ? "常见原因：Bridge 未启动、掉线或返回 503。本次 run 已结束，修好后点「重新执行」（可复用选仓）。"
        : err
          ? "本次运行已结束。修好问题后点「重新执行」。"
          : "本次运行已结束。请查看运行日志后点「重新执行」。",
      offerRestart: true,
    };
  }
  if (dify.status === "paused" || order.status === "pending_approval") {
    const recoverHint =
      !dify.form_token &&
      /form_token|Human Input|Web App/i.test(dify.raw_summary || "")
        ? dify.raw_summary
        : null;
    return {
      type: "warning",
      message: `等待确认 · ${dify.status || "paused"}`,
      hint: order.run?.auto_approve
        ? "已开自动确认：Studio 将代为通过门禁"
        : dify.form_token
          ? "人工确认可在下方 Studio 完成"
          : recoverHint || "正在同步门禁表单；请检查 Bridge",
    };
  }
  return {
    type: "info",
    message: `运行状态 · ${dify.status || "unknown"}`,
    hint: dify.form_token
      ? "人工确认可在下方 Studio 完成"
      : "正在同步门禁表单",
  };
}

function bannerTitle(
  order: WorkOrder,
  currentStep: WorkOrderRunStep | undefined,
): string {
  switch (order.status) {
    case "queued":
      return "排队等待空闲 Bridge";
    case "running":
      if (!currentStep || currentStep.status === "pending") {
        return "正在启动流水线";
      }
      return `正在执行：${currentStep.label || currentStep.step_id}`;
    case "pending_approval":
      return currentStep
        ? `等待确认：${currentStep.label || currentStep.step_id}`
        : "等待人工确认";
    case "completed":
      return "流水线已完成";
    case "failed":
      return "流水线失败";
    case "rejected":
      return "已驳回";
    default:
      return `状态 · ${order.status}`;
  }
}

/** Run timeline + agent outputs + human approval block for a work order. */
export function WorkOrderRunPanel(props: Props) {
  if (!props.order.run) {
    return <Empty description="尚未启动流水线" />;
  }
  return <WorkOrderRunPanelBody {...props} />;
}

function WorkOrderRunPanelBody({
  order,
  feedback,
  onFeedbackChange,
  onDecide,
  onRestart,
  onOrderUpdate,
}: Props) {
  const [chatOpen, setChatOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const run = order.run!;

  const isStudio = run.executor === "studio" || !run.executor;
  const studio = run.studio;
  const currentStep = run.steps[run.current_step_index] as
    | WorkOrderRunStep
    | undefined;
  const autoApprove = Boolean(run.auto_approve);
  const events = run.events || [];
  const latestEvent = events.length ? events[events.length - 1] : undefined;
  const recentEvents = [...events].reverse().slice(0, 40);
  const bridgeRunId =
    studio?.bridge_run_id || run.dify?.bridge_run_id || undefined;

  const detailText =
    (studio?.error || "").trim() ||
    (currentStep?.summary || "").trim() ||
    (studio?.last_summary || "").trim() ||
    (latestEvent?.message || "").trim() ||
    (order.status === "queued"
      ? run.pending_start?.note ||
        "团队 Bridge 忙碌，工单排队中；空闲后将自动启动。"
      : "");

  const outputStep =
    [...run.steps].reverse().find((s) => s.output?.trim()) || currentStep;
  const stepIndex = Math.min(run.current_step_index + 1, run.steps.length || 1);
  const stepTotal = run.steps.length || 0;
  const stage = (studio?.current_stage || "").trim();
  const dryRun =
    Boolean(studio?.dry_run) ||
    Boolean(run.dify?.bridge_dry_run) ||
    events.some((e) => e.dry_run) ||
    run.steps.some((s) =>
      /\[dry-run\]|CURSOR_API_KEY missing/i.test(s.output || ""),
    );

  const moreItems = [
    ...(run.repo_targets?.length || run.selected_repo_ids?.length
      ? [
          {
            key: "repos",
            label: "改仓计划",
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  {run.repo_targets?.length
                    ? `按序执行：${run.repo_targets.map((t) => t.repo_id).join(" → ")}`
                    : `选仓：${(run.selected_repo_ids || []).join(", ")}`}
                </Typography.Paragraph>
                {run.manager_routing_reason ? (
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                    {run.manager_routing_reason}
                  </Typography.Paragraph>
                ) : null}
                {run.repo_targets?.length ? (
                  <Steps
                    size="small"
                    direction="vertical"
                    current={run.current_repo_index ?? 0}
                    items={run.repo_targets.map((t, i) => ({
                      title: `${i + 1}. ${t.repo_id}${t.name ? ` · ${t.name}` : ""}`,
                      description: (
                        <Space direction="vertical" size={0}>
                          <Typography.Text type="secondary">
                            {t.role || "unknown"} · {t.status}
                          </Typography.Text>
                          {t.agents_md_path ? (
                            <Typography.Text code copyable style={{ fontSize: 12 }}>
                              {t.agents_md_path}
                            </Typography.Text>
                          ) : null}
                        </Space>
                      ),
                      status:
                        t.status === "completed"
                          ? "finish"
                          : t.status === "failed"
                            ? "error"
                            : t.status === "running"
                              ? "process"
                              : "wait",
                    }))}
                  />
                ) : run.selected_agents_md_path ? (
                  <Typography.Text code copyable>
                    {run.selected_agents_md_path}
                  </Typography.Text>
                ) : null}
              </>
            ),
          },
        ]
      : []),
    {
      key: "artifacts",
      label: "Bridge 产物",
      children: (
        <RunArtifactsPanel
          runId={run.run_id}
          bridgeRunId={bridgeRunId}
        />
      ),
    },
    {
      key: "all-outputs",
      label: "全部 Agent 产出",
      children: run.steps.some((s) => s.output) ? (
        <Collapse
          accordion={false}
          defaultActiveKey={run.steps
            .map((s, i) => (s.output ? String(i) : ""))
            .filter(Boolean)
            .slice(-1)}
          items={run.steps.flatMap((s, i) =>
            s.output
              ? [
                  {
                    key: String(i),
                    label: (
                      <Space wrap>
                        <span>{s.output_title || s.label || s.step_id}</span>
                        <Tag>{s.agent}</Tag>
                        <Tag color={STEP_STATUS_LABEL[s.status]?.color || "default"}>
                          {STEP_STATUS_LABEL[s.status]?.text || s.status}
                        </Tag>
                      </Space>
                    ),
                    children: <AgentOutputView output={s.output} />,
                  },
                ]
              : [],
          )}
        />
      ) : (
        <Empty description="尚无 Agent 产出" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ),
    },
    {
      key: "ids",
      label: "关联 ID",
      children: (
        <Space size={4} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Studio
          </Typography.Text>
          <Typography.Text code copyable={{ text: run.run_id }} style={{ fontSize: 12 }}>
            {run.run_id}
          </Typography.Text>
          <Link to={`/logs/${run.run_id}`}>
            <Button size="small" type="link" style={{ paddingInline: 4, fontSize: 12 }}>
              日志
            </Button>
          </Link>
          {bridgeRunId ? (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Bridge
              </Typography.Text>
              <Typography.Text
                code
                copyable={{ text: bridgeRunId }}
                style={{ fontSize: 12 }}
              >
                {bridgeRunId}
              </Typography.Text>
              <Link to={`/logs?q=${encodeURIComponent(bridgeRunId)}`}>
                <Button size="small" type="link" style={{ paddingInline: 4, fontSize: 12 }}>
                  检索
                </Button>
              </Link>
            </>
          ) : null}
          {!isStudio && run.dify?.workflow_run_id ? (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Legacy run
              </Typography.Text>
              <Typography.Text
                code
                copyable={{ text: run.dify.workflow_run_id }}
                style={{ fontSize: 12 }}
              >
                {run.dify.workflow_run_id.length > 14
                  ? `${run.dify.workflow_run_id.slice(0, 12)}…`
                  : run.dify.workflow_run_id}
              </Typography.Text>
            </>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div className="wo-run-panel">
      <div className="wo-run-now">
        <div className="wo-run-now-top">
          <Typography.Title level={5} style={{ margin: 0 }}>
            {bannerTitle(order, currentStep)}
          </Typography.Title>
          <Space wrap size={6}>
            <Button
              size="small"
              icon={<CommentOutlined />}
              onClick={() => setChatOpen(true)}
            >
              Agent 聊天
            </Button>
            <Button
              size="small"
              icon={<ExpandOutlined />}
              onClick={() => setOutputOpen(true)}
            >
              全屏产出
            </Button>
            <Button
              size="small"
              icon={<AppstoreOutlined />}
              onClick={() => setMoreOpen(true)}
            >
              更多详情
            </Button>
            <Link to={`/logs/${run.run_id}`}>
              <Button size="small" icon={<ProfileOutlined />}>
                完整日志
              </Button>
            </Link>
          </Space>
        </div>

        {detailText ? (
          <Typography.Paragraph type="secondary" className="wo-run-now-detail">
            {detailText}
          </Typography.Paragraph>
        ) : null}

        <div className="wo-run-now-meta">
          <Tag color={STATUS_LABEL[order.status]?.color || "processing"}>
            {STATUS_LABEL[order.status]?.text || order.status}
          </Tag>
          <Tag color="cyan">Studio 编排</Tag>
          {stepTotal > 0 ? (
            <Tag>
              步骤 {stepIndex}/{stepTotal}
            </Tag>
          ) : null}
          {stage ? <Tag color="green">{stage}</Tag> : null}
          <Tag color={autoApprove ? "success" : "default"}>
            自动确认：{autoApprove ? "开" : "关"}
          </Tag>
          {bridgeRunId ? (
            <Tag>
              Bridge{" "}
              <Typography.Text code copyable={{ text: bridgeRunId }} style={{ fontSize: 12 }}>
                {bridgeRunId.length > 16 ? `${bridgeRunId.slice(0, 14)}…` : bridgeRunId}
              </Typography.Text>
            </Tag>
          ) : null}
        </div>

        {order.status === "failed" && onRestart ||
        order.status === "pending_approval" ? (
          <div className="wo-run-now-actions">
            {order.status === "failed" && onRestart ? (
              <Button size="small" type="primary" onClick={onRestart}>
                重新执行
              </Button>
            ) : null}
            {order.status === "pending_approval" ? (
              <>
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckOutlined />}
                  onClick={() => onDecide("approve")}
                >
                  通过
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<CloseOutlined />}
                  onClick={() => onDecide("reject")}
                >
                  驳回
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {dryRun ? (
        <Alert
          className="wo-run-block"
          type="warning"
          showIcon
          message="历史运行含 dry-run 痕迹"
          description="该模式已移除。请用真实 Agent（cursor / trae / qoder）重新执行。"
        />
      ) : null}

      {run.git?.commit_sha ? (
        <Alert
          className="wo-run-block"
          type="success"
          showIcon
          message="评审后已提交代码"
          description={
            <Space direction="vertical" size={0}>
              <Typography.Text>
                {run.git.branch ? (
                  <>
                    分支 <Typography.Text code>{run.git.branch}</Typography.Text>
                    {" · "}
                  </>
                ) : null}
                commit <Typography.Text code>{run.git.commit_sha}</Typography.Text>
              </Typography.Text>
              {run.git.commit_message ? (
                <Typography.Text type="secondary">{run.git.commit_message}</Typography.Text>
              ) : null}
              {run.git.pr_url ? (
                <Typography.Link href={run.git.pr_url} target="_blank">
                  {run.git.pr_url}
                </Typography.Link>
              ) : null}
              {run.git.note ? (
                <Typography.Text type="secondary">{run.git.note}</Typography.Text>
              ) : null}
            </Space>
          }
        />
      ) : null}

      <Card size="small" className="wo-run-section" title="流水线步骤">
        <Steps
          className="wo-run-steps"
          direction="horizontal"
          size="small"
          responsive
          current={run.current_step_index}
          items={run.steps.map((s) => ({
            title: (
              <span className="wo-run-step-title">
                {s.label || s.step_id}
                {s.human_approval ? (
                  <Tag
                    color={autoApprove ? "success" : "warning"}
                    className="wo-run-step-tag"
                  >
                    {autoApprove ? "自动确认" : "需确认"}
                  </Tag>
                ) : null}
              </span>
            ),
            description: (
              <div className="wo-run-step-desc">
                <div>
                  {s.agent} · {STEP_STATUS_LABEL[s.status]?.text || s.status}
                </div>
                {s.summary ? (
                  <div className="wo-run-step-summary" title={s.summary}>
                    {s.summary}
                  </div>
                ) : null}
                {s.feedback ? (
                  <div className="wo-run-step-feedback">反馈：{s.feedback}</div>
                ) : null}
              </div>
            ),
            status: STEP_STATUS_MAP[s.status],
          }))}
        />
      </Card>

      <div className="wo-run-live">
        <Card size="small" className="wo-run-section" title="实时动态">
          {recentEvents.length ? (
            <div className="wo-run-live-scroll">
              {recentEvents.map((e, idx) => (
                <div className="wo-run-live-row" key={e.id || `${e.at}-${idx}`}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatEventTime(e.at)}
                  </Typography.Text>
                  <div>
                    <Space wrap size={4} style={{ marginBottom: 4 }}>
                      <Tag>{e.type}</Tag>
                      {e.bridge_stage ? <Tag color="green">{e.bridge_stage}</Tag> : null}
                      {e.dry_run ? <Tag color="orange">dry-run</Tag> : null}
                    </Space>
                    <Typography.Paragraph
                      style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
                    >
                      {e.message}
                    </Typography.Paragraph>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              尚无结构化日志。可点「完整日志」按 run_id 查看。
            </Typography.Paragraph>
          )}
        </Card>

        <Card
          size="small"
          className="wo-run-section"
          title={
            outputStep?.output
              ? `当前产出 · ${outputStep.output_title || outputStep.label || outputStep.step_id}`
              : "当前产出"
          }
          extra={
            <Button
              type="link"
              size="small"
              icon={<ExpandOutlined />}
              disabled={!outputStep?.output?.trim()}
              onClick={() => setOutputOpen(true)}
            >
              全屏
            </Button>
          }
        >
          {outputStep?.output?.trim() ? (
            <div
              className="wo-run-live-scroll"
              role="button"
              tabIndex={0}
              onDoubleClick={() => setOutputOpen(true)}
              title="双击全屏查看"
            >
              <AgentOutputView output={outputStep.output} maxHeight={280} />
            </div>
          ) : order.status === "running" || order.status === "queued" ? (
            <Empty
              description="运行中，产出稍后出现"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <Empty description="尚无产出" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>
      </div>

      {order.status === "pending_approval" && currentStep ? (
        <ApprovalCard
          order={order}
          currentStep={currentStep}
          feedback={feedback}
          onFeedbackChange={onFeedbackChange}
          onDecide={onDecide}
        />
      ) : null}

      <Drawer
        title="Agent 聊天"
        placement="right"
        width={480}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        destroyOnClose={false}
        className="wo-chat-drawer"
        styles={{ body: { display: "flex", flexDirection: "column", overflow: "hidden" } }}
      >
        <WorkOrderAgentChat fill order={order} onOrderUpdate={onOrderUpdate} />
      </Drawer>

      <Modal
        title="更多详情"
        open={moreOpen}
        onCancel={() => setMoreOpen(false)}
        footer={null}
        width={820}
        destroyOnHidden
      >
        <Collapse accordion={false} defaultActiveKey={["artifacts", "all-outputs"]} items={moreItems} />
      </Modal>

      <Modal
        title={
          outputStep?.output
            ? outputStep.output_title || outputStep.label || "Agent 产出"
            : "Agent 产出"
        }
        open={outputOpen}
        onCancel={() => setOutputOpen(false)}
        footer={null}
        width="92vw"
        style={{ top: 16 }}
        className="wo-fullscreen-modal"
        destroyOnHidden
      >
        {outputStep?.output ? (
          <AgentOutputView output={outputStep.output} />
        ) : (
          <Empty description="尚无产出" />
        )}
      </Modal>
    </div>
  );
}

function ApprovalCard({
  order,
  currentStep,
  feedback,
  onFeedbackChange,
  onDecide,
}: {
  order: WorkOrder;
  currentStep: WorkOrderRunStep;
  feedback: string;
  onFeedbackChange: (value: string) => void;
  onDecide: (
    decision: "approve" | "reject",
    action?: string,
    feedbackOverride?: string,
  ) => void;
}) {
  const run = order.run!;
  const studio = run.studio;
  const dify = run.dify;
  const isStudio = run.executor === "studio" || !run.executor;
  const canDecide = isStudio || Boolean(dify?.form_token);
  const autoApprove = Boolean(run.auto_approve);
  const oqSources = [
    currentStep.output,
    studio?.last_summary,
    dify?.form_content,
    ...run.steps.map((s) => s.output),
  ];
  const showChecklist = hasOpenQuestions(oqSources);

  return (
    <Card
      size="small"
      className="wo-run-section wo-run-approval"
      title={
        <Space wrap>
          <span>
            {studio?.current_stage
              ? `人工确认 · ${studio.current_stage}`
              : dify?.form_node_title || "Studio 人工确认"}
          </span>
          <Tag color={autoApprove ? "success" : "warning"}>
            自动确认：{autoApprove ? "已开启" : "未开启"}
          </Tag>
          {showChecklist ? <Tag color="blue">澄清清单</Tag> : null}
        </Space>
      }
    >
      {autoApprove && !showChecklist ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="本轮已开自动确认"
          description="通常无需手动操作；若未自动通过，可在下方手动提交。"
        />
      ) : null}

      {showChecklist ? (
        <ClarificationChecklist
          sources={oqSources}
          autoApprove={autoApprove}
          onSubmit={(text) => {
            onFeedbackChange(text);
            onDecide("approve", undefined, text);
          }}
          onReject={() => onDecide("reject")}
        />
      ) : null}

      {!showChecklist && (studio?.last_summary || dify?.form_content) ? (
        <MarkdownBody content={studio?.last_summary || dify?.form_content || ""} />
      ) : null}

      {!showChecklist ? (
        <Typography.Paragraph>
          当前步骤：{currentStep.label || currentStep.step_id}（{currentStep.agent}）
          {studio?.bridge_run_id ? (
            <>
              {" "}
              · Bridge run{" "}
              <Typography.Text code copyable={{ text: studio.bridge_run_id }}>
                {studio.bridge_run_id}
              </Typography.Text>
            </>
          ) : null}
        </Typography.Paragraph>
      ) : null}

      {!showChecklist ? (
        <>
          <Input.TextArea
            rows={2}
            placeholder="可选反馈（写入 Bridge decision）"
            value={feedback}
            onChange={(e) => onFeedbackChange(e.target.value)}
            style={{ marginBottom: 12 }}
          />

          <Space wrap>
            {!isStudio && dify?.form_actions?.length ? (
              dify.form_actions.map((a) => {
                const rejectish = /reject|驳回|拒绝/i.test(a.id + (a.title || ""));
                return (
                  <Button
                    key={a.id}
                    type={
                      a.button_style === "primary" ||
                      /approv|通过|同意/i.test(a.id + (a.title || ""))
                        ? "primary"
                        : "default"
                    }
                    danger={rejectish}
                    disabled={!canDecide}
                    onClick={() =>
                      onDecide(rejectish ? "reject" : "approve", a.id)
                    }
                  >
                    {a.title || a.id}
                  </Button>
                );
              })
            ) : (
              <>
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  disabled={!canDecide}
                  onClick={() => onDecide("approve")}
                >
                  通过并继续
                </Button>
                <Button
                  danger
                  icon={<CloseOutlined />}
                  disabled={!canDecide}
                  onClick={() => onDecide("reject")}
                >
                  驳回
                </Button>
              </>
            )}
          </Space>
        </>
      ) : null}
    </Card>
  );
}
