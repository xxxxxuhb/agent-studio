import {
  Alert,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  Space,
  Steps,
  Tag,
  Typography,
} from "antd";
import { CheckOutlined, CloseOutlined, ProfileOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import type { WorkOrder, WorkOrderRunStep } from "@agent-studio/agent-schema";
import { AgentOutputView } from "./AgentOutputView";
import {
  ClarificationChecklist,
  hasOpenQuestions,
} from "./ClarificationChecklist";
import { MarkdownBody } from "./MarkdownBody";
import {
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
};

type DifyAlertInfo = {
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

function describeDifyAlert(
  order: WorkOrder,
  dify: NonNullable<NonNullable<WorkOrder["run"]>["dify"]>,
): DifyAlertInfo {
  const err = (dify.error || "").trim();
  const summary = (dify.raw_summary || "").trim();
  const softHeld = order.status === "running" && Boolean(err);
  const syncFailed =
    softHeld &&
    (err.startsWith("同步失败:") ||
      /拉取 Dify 状态失败|get run failed|Dify get run/i.test(summary || err));
  const transientBridge =
    /\b(502|503|504)\b|bridge_busy|econnrefused|fetch failed|不可达|掉线|瞬时/i.test(
      `${err}\n${summary}`,
    );

  if (syncFailed) {
    return {
      type: "warning",
      message: "Dify 状态同步失败（可重试）",
      hint: "拉取 workflow run 失败；可稍后点「同步 Dify」重试，或「重新执行」开新一轮。",
      offerRestart: true,
    };
  }
  if (dify.status === "failed" || order.status === "failed") {
    return {
      type: transientBridge ? "warning" : "error",
      message: transientBridge
        ? "Dify 工作流失败（疑似 Bridge/网络瞬时）"
        : "Dify 工作流失败",
      hint: transientBridge
        ? "常见原因：Bridge 未启动、掉线或返回 503。本次 run 已结束，修好后点「重新执行」（可复用选仓）。"
        : err
          ? "本次运行已结束。修好问题后点「重新执行」。"
          : "本次运行已结束。请查看 Dify 日志后点「重新执行」。",
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
      message: `Dify ${dify.status || "paused"}`,
      hint: order.run?.auto_approve
        ? "已开自动确认：Studio 将代为通过门禁"
        : dify.form_token
          ? "Human Input 可在下方 Studio 确认"
          : recoverHint ||
            "正在自动同步 form_token（也可手动点「同步 Dify」）；Human Input 须为 Web App 投递",
    };
  }
  return {
    type: "info",
    message: `Dify ${dify.status || "unknown"}`,
    hint: dify.form_token
      ? "Human Input 可在下方 Studio 确认"
      : "正在自动同步 form_token（也可手动点「同步 Dify」）",
  };
}

/** Run timeline + agent outputs + human/Dify approval block for a work order. */
export function WorkOrderRunPanel({
  order,
  feedback,
  onFeedbackChange,
  onDecide,
  onRestart,
}: Props) {
  const run = order.run;
  if (!run) {
    return <Empty description="尚未启动流水线" />;
  }

  const currentStep = run.steps[run.current_step_index] as
    | WorkOrderRunStep
    | undefined;
  const autoApprove = Boolean(run.auto_approve);
  const humanGates = run.steps.filter((s) => s.human_approval).length;

  const difyAlert = run.dify ? describeDifyAlert(order, run.dify) : null;
  const events = run.events || [];
  const dryRun =
    Boolean(run.dify?.bridge_dry_run) ||
    events.some((e) => e.dry_run) ||
    run.steps.some((s) => /\[dry-run\]|CURSOR_API_KEY missing/i.test(s.output || ""));

  const startedLabel = (() => {
    try {
      return new Date(run.started_at).toLocaleString();
    } catch {
      return run.started_at;
    }
  })();

  return (
    <div className="wo-run-panel">
      <div className="wo-run-header">
        <div className="wo-run-header-main">
          <Typography.Title level={5} className="wo-run-title">
            执行面板
          </Typography.Title>
          <Typography.Text type="secondary" className="wo-run-subtitle">
            {run.pipeline_name}
            <span className="wo-run-sep">·</span>
            <Typography.Text code copyable={{ text: run.run_id }}>
              {run.run_id}
            </Typography.Text>
            <span className="wo-run-sep">·</span>
            启动于 {startedLabel}
          </Typography.Text>
        </div>
        <Link to={`/logs/${run.run_id}`}>
          <Button size="small" icon={<ProfileOutlined />}>
            完整日志
          </Button>
        </Link>
      </div>

      <div className="wo-run-meta">
        <div className="wo-run-meta-item">
          <span className="wo-run-meta-label">执行器</span>
          <Tag color="cyan">Dify Workflow</Tag>
        </div>
        <div className="wo-run-meta-item wo-run-meta-emphasis">
          <span className="wo-run-meta-label">自动确认</span>
          <Tag color={autoApprove ? "success" : "default"}>
            {autoApprove ? "已开启" : "未开启"}
          </Tag>
          <Typography.Text type="secondary" className="wo-run-meta-hint">
            {autoApprove
              ? "门禁由 Studio 代为通过（流水线节点仍保留）"
              : "遇人工确认需手动点通过"}
          </Typography.Text>
        </div>
        <div className="wo-run-meta-item">
          <span className="wo-run-meta-label">人工门禁</span>
          <Tag>
            {humanGates}/{run.steps.length} 步
          </Tag>
        </div>
        {currentStep ? (
          <div className="wo-run-meta-item">
            <span className="wo-run-meta-label">当前步骤</span>
            <Tag color={STEP_STATUS_LABEL[currentStep.status]?.color || "processing"}>
              {currentStep.label || currentStep.step_id}
            </Tag>
          </div>
        ) : null}
      </div>

      {autoApprove && order.status === "pending_approval" ? (
        <Alert
          className="wo-run-block"
          type="info"
          showIcon
          message="自动确认已开启"
          description="正在等待门禁表单就绪后由 Studio 代为提交通过；若长时间停在此状态，可点「同步 Dify」或检查 Bridge。"
        />
      ) : null}

      {dryRun ? (
        <Alert
          className="wo-run-block"
          type="warning"
          showIcon
          message="历史运行含 dry-run 痕迹"
          description="该模式已移除。请用真实 Agent（cursor / trae / qoder）重新执行。"
        />
      ) : null}

      {run.repo_targets?.length || run.selected_repo_ids?.length ? (
        <Card size="small" className="wo-run-section" title="改仓计划">
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
        </Card>
      ) : null}

      {run.dify && difyAlert ? (
        <Alert
          className="wo-run-block"
          type={difyAlert.type}
          showIcon
          message={difyAlert.message}
          action={
            difyAlert.offerRestart && onRestart ? (
              <Button size="small" type="primary" onClick={onRestart}>
                重新执行
              </Button>
            ) : undefined
          }
          description={
            <Space direction="vertical" size={0}>
              <Typography.Text type="secondary">
                run: {run.dify.workflow_run_id || "-"}
                {run.dify.last_synced_at
                  ? ` · synced ${run.dify.last_synced_at}`
                  : ""}
              </Typography.Text>
              {run.dify.error ? (
                <Typography.Text
                  type={
                    difyAlert.type === "error"
                      ? "danger"
                      : difyAlert.type === "warning"
                        ? "warning"
                        : undefined
                  }
                >
                  {run.dify.error}
                </Typography.Text>
              ) : null}
              <Typography.Text type="secondary">{difyAlert.hint}</Typography.Text>
            </Space>
          }
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

      <Collapse
        className="wo-run-section wo-run-log-section"
        defaultActiveKey={["run-logs"]}
        items={[
          {
            key: "run-logs",
            label: (
              <Space wrap size={8}>
                <span>运行日志</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {events.length} 条
                </Typography.Text>
              </Space>
            ),
            children: (
              <>
                {events.length ? (
                  <Collapse
                    className="wo-run-log-collapse"
                    defaultActiveKey={[]}
                    items={[...events]
                      .reverse()
                      .slice(0, 40)
                      .map((e, idx) => ({
                        key: e.id || `${e.at}-${idx}`,
                        label: (
                          <div className="wo-run-log-item">
                            <div className="wo-run-log-meta">
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {formatEventTime(e.at)}
                              </Typography.Text>
                              <Tag>{e.type}</Tag>
                              {e.bridge_stage ? (
                                <Tag color="green">{e.bridge_stage}</Tag>
                              ) : null}
                              {e.dry_run ? <Tag color="orange">dry-run</Tag> : null}
                              {e.action ? <Tag color="blue">{e.action}</Tag> : null}
                              {e.step_id || e.agent ? (
                                <Typography.Text
                                  type="secondary"
                                  style={{ fontSize: 12 }}
                                >
                                  {[e.step_id, e.agent].filter(Boolean).join(" · ")}
                                </Typography.Text>
                              ) : null}
                            </div>
                            <Typography.Text className="wo-run-log-msg wo-run-log-msg-preview">
                              {e.message.replace(/\s+/g, " ").trim().slice(0, 140)}
                              {e.message.replace(/\s+/g, " ").trim().length > 140
                                ? "…"
                                : ""}
                            </Typography.Text>
                          </div>
                        ),
                        children: (
                          <Typography.Paragraph
                            className="wo-run-log-msg"
                            style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
                          >
                            {e.message}
                          </Typography.Paragraph>
                        ),
                      }))}
                  />
                ) : (
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    尚无结构化日志。可点右上角「完整日志」按 run_id 查看。
                  </Typography.Paragraph>
                )}
                {events.length > 40 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    仅展示最近 40 条，完整记录见「完整日志」。
                  </Typography.Text>
                ) : null}
              </>
            ),
          },
        ]}
      />

      <Card size="small" className="wo-run-section" title="Agent 产出">
        {run.steps.some((s) => s.output) ? (
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
        )}
      </Card>

      {order.status === "pending_approval" && currentStep ? (
        <ApprovalCard
          order={order}
          currentStep={currentStep}
          feedback={feedback}
          onFeedbackChange={onFeedbackChange}
          onDecide={onDecide}
        />
      ) : null}
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
  const dify = run.dify;
  const autoApprove = Boolean(run.auto_approve);
  const oqSources = [
    dify?.form_content,
    currentStep.output,
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
            {dify?.form_node_title || "Dify 人工确认"}
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
          description="通常无需手动操作；若未自动通过，可在下方手动提交，或点「同步 Dify」。"
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

      {dify?.form_content && !showChecklist ? (
        <MarkdownBody content={dify.form_content} />
      ) : null}

      {!showChecklist ? (
        <Typography.Paragraph>
          当前步骤：{currentStep.label || currentStep.step_id}（{currentStep.agent}）
        </Typography.Paragraph>
      ) : null}

      {!dify?.form_token ? (
        <Alert
          type={
            /失败|过期|Web App/i.test(dify?.raw_summary || "")
              ? "warning"
              : "info"
          }
          showIcon
          style={{ marginBottom: 12 }}
          message="正在自动拉取门禁表单…"
          description={
            dify?.raw_summary?.trim()
              ? dify.raw_summary
              : "Studio 会定时同步 Dify；拿到 form_token 后即可通过/驳回。也可手动点「同步 Dify」。"
          }
        />
      ) : null}

      {!showChecklist ? (
        <>
          <Input.TextArea
            rows={2}
            placeholder="可选反馈（会写入 Dify 表单对应字段）"
            value={feedback}
            onChange={(e) => onFeedbackChange(e.target.value)}
            style={{ marginBottom: 12 }}
          />

          <Space wrap>
            {dify?.form_actions?.length ? (
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
                    disabled={!dify.form_token}
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
                  disabled={!dify?.form_token}
                  onClick={() => onDecide("approve")}
                >
                  通过并继续
                </Button>
                <Button
                  danger
                  icon={<CloseOutlined />}
                  disabled={!dify?.form_token}
                  onClick={() => onDecide("reject")}
                >
                  驳回
                </Button>
              </>
            )}
          </Space>
        </>
      ) : dify?.form_actions?.length ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
          也可使用 Dify 原始按钮：
          <Space wrap style={{ marginLeft: 8 }}>
            {dify.form_actions.map((a) => {
              const rejectish = /reject|驳回|拒绝/i.test(a.id + (a.title || ""));
              return (
                <Button
                  key={a.id}
                  size="small"
                  danger={rejectish}
                  disabled={!dify.form_token}
                  onClick={() =>
                    onDecide(rejectish ? "reject" : "approve", a.id)
                  }
                >
                  {a.title || a.id}
                </Button>
              );
            })}
          </Space>
        </Typography.Paragraph>
      ) : null}
    </Card>
  );
}
