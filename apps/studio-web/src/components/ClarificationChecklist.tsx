import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  Radio,
  Space,
  Tag,
  Typography,
} from "antd";
import { CheckOutlined, RollbackOutlined } from "@ant-design/icons";
import {
  answersFromDefaults,
  formatOpenQuestionFeedback,
  parseOpenQuestions,
  suggestOptions,
  type OpenQuestion,
  type OpenQuestionAnswer,
} from "../work-orders/parseOpenQuestions";

type Props = {
  sources: Array<string | null | undefined>;
  autoApprove?: boolean;
  onSubmit: (feedback: string, mode: "defaults" | "custom") => void;
  onReject?: () => void;
  submitting?: boolean;
};

type Draft = {
  mode: "default" | "custom" | "option";
  /** selected preset option or custom text */
  value: string;
};

function buildDrafts(questions: OpenQuestion[]): Record<string, Draft> {
  const next: Record<string, Draft> = {};
  for (const q of questions) {
    next[q.id] = { mode: "default", value: q.defaultAnswer };
  }
  return next;
}

function toAnswers(
  questions: OpenQuestion[],
  drafts: Record<string, Draft>,
): OpenQuestionAnswer[] {
  return questions.map((q) => {
    const d = drafts[q.id] || { mode: "default" as const, value: q.defaultAnswer };
    const answer = (d.value || q.defaultAnswer).trim() || q.defaultAnswer;
    return {
      id: q.id,
      question: q.question,
      answer,
      usedDefault: d.mode === "default" || answer === q.defaultAnswer,
    };
  });
}

/**
 * Interactive open-questions checklist for human gates.
 * Prefills defaults; supports one-click approve-all-defaults.
 */
export function ClarificationChecklist({
  sources,
  autoApprove,
  onSubmit,
  onReject,
  submitting,
}: Props) {
  const questions = useMemo(() => {
    const merged: OpenQuestion[] = [];
    const seen = new Set<string>();
    for (const src of sources) {
      for (const q of parseOpenQuestions(src)) {
        if (seen.has(q.id)) continue;
        seen.add(q.id);
        merged.push(q);
      }
    }
    return merged;
  }, [sources]);

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    buildDrafts(questions),
  );

  useEffect(() => {
    setDrafts(buildDrafts(questions));
  }, [questions]);

  if (!questions.length) return null;

  const dirtyCount = questions.filter((q) => {
    const d = drafts[q.id];
    if (!d) return false;
    return d.mode !== "default" && d.value.trim() !== q.defaultAnswer;
  }).length;

  return (
    <div className="oq-checklist">
      <div className="oq-checklist-head">
        <div>
          <Typography.Text strong>待澄清问题</Typography.Text>
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {questions.length} 项 · 默认已预选
            {dirtyCount ? ` · 已改 ${dirtyCount} 项` : ""}
          </Typography.Text>
        </div>
        <Button
          size="small"
          icon={<RollbackOutlined />}
          onClick={() => setDrafts(buildDrafts(questions))}
        >
          全部恢复默认
        </Button>
      </div>

      {autoApprove ? (
        <Alert
          type="info"
          showIcon
          className="oq-checklist-alert"
          message="自动确认已开启"
          description="将按下列默认项提交通过；你仍可先改选项再手动提交。"
        />
      ) : (
        <Alert
          type="warning"
          showIcon
          className="oq-checklist-alert"
          message="请核对默认项"
          description="无异议可一键按默认通过；有异议请改选项后提交我的选择。"
        />
      )}

      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        {questions.map((q) => {
          const draft = drafts[q.id] || {
            mode: "default" as const,
            value: q.defaultAnswer,
          };
          const options = suggestOptions(q);
          return (
            <Card key={q.id} size="small" className="oq-item">
              <Space wrap size={6} style={{ marginBottom: 6 }}>
                <Tag color="blue">{q.id}</Tag>
                {draft.mode === "default" ? (
                  <Tag>默认</Tag>
                ) : (
                  <Tag color="orange">已修改</Tag>
                )}
              </Space>
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                {q.question}
              </Typography.Paragraph>
              {q.impact ? (
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  影响：{q.impact}
                </Typography.Paragraph>
              ) : null}

              <Radio.Group
                value={
                  draft.mode === "default"
                    ? "__default__"
                    : options?.includes(draft.value)
                      ? draft.value
                      : "__custom__"
                }
                onChange={(e) => {
                  const v = e.target.value as string;
                  setDrafts((prev) => {
                    if (v === "__default__") {
                      return {
                        ...prev,
                        [q.id]: { mode: "default", value: q.defaultAnswer },
                      };
                    }
                    if (v === "__custom__") {
                      return {
                        ...prev,
                        [q.id]: {
                          mode: "custom",
                          value:
                            prev[q.id]?.mode === "custom"
                              ? prev[q.id]!.value
                              : "",
                        },
                      };
                    }
                    return {
                      ...prev,
                      [q.id]: { mode: "option", value: v },
                    };
                  });
                }}
                style={{ width: "100%" }}
              >
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                  <Radio value="__default__">
                    采用默认
                    <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                      {q.defaultAnswer}
                    </Typography.Text>
                  </Radio>
                  {options
                    ?.filter((o) => o !== q.defaultAnswer)
                    .map((o) => (
                      <Radio key={o} value={o}>
                        {o}
                      </Radio>
                    ))}
                  <Radio value="__custom__">自定义</Radio>
                </Space>
              </Radio.Group>

              {draft.mode === "custom" ? (
                <Input.TextArea
                  style={{ marginTop: 8 }}
                  rows={2}
                  placeholder="填写你的决定"
                  value={draft.value}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [q.id]: { mode: "custom", value: e.target.value },
                    }))
                  }
                />
              ) : null}
            </Card>
          );
        })}
      </Space>

      <Space wrap className="oq-checklist-actions">
        <Button
          type="primary"
          icon={<CheckOutlined />}
          loading={submitting}
          onClick={() => {
            const answers = answersFromDefaults(questions);
            onSubmit(
              formatOpenQuestionFeedback(answers, "澄清确认（按默认全部通过）"),
              "defaults",
            );
          }}
        >
          按默认全部通过
        </Button>
        <Button
          loading={submitting}
          onClick={() => {
            const answers = toAnswers(questions, drafts);
            onSubmit(
              formatOpenQuestionFeedback(answers, "澄清确认（提交我的选择）"),
              "custom",
            );
          }}
        >
          提交我的选择
        </Button>
        {onReject ? (
          <Button danger loading={submitting} onClick={onReject}>
            驳回
          </Button>
        ) : null}
      </Space>
    </div>
  );
}

/** True when markdown sources contain a parseable open-questions table. */
export function hasOpenQuestions(sources: Array<string | null | undefined>): boolean {
  return sources.some((s) => parseOpenQuestions(s).length > 0);
}
