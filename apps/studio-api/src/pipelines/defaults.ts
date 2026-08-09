import { PipelineCreateSchema, type PipelineCreate } from "@agent-studio/agent-schema";

function linearSteps(
  agents: Array<{ id: string; agent: string; label: string; on_reject?: "end" | "goto"; reject_goto?: string }>,
): PipelineCreate["steps"] {
  return agents.map((step, index) => ({
    id: step.id,
    agent: step.agent,
    label: step.label,
    human_approval: true,
    on_reject: step.on_reject || "end",
    reject_goto: step.reject_goto,
    inputs_from: index === 0 ? [] : [agents[index - 1].id],
  }));
}

export const DEFAULT_PIPELINES = [
  {
    id: "standard-delivery",
    name: "标准交付",
    description: "需求定稿 → 计划 → 开发 → 测试 → 运维（staging），适合快速交付。",
    enabled: true,
    tags: ["default", "delivery"],
    source: { kind: "template", template_id: "standard-delivery" },
    defaults: { human_approval: true, on_reject: "end" },
    steps: linearSteps([
      { id: "requirement", agent: "requirement", label: "需求定稿" },
      { id: "plan", agent: "plan", label: "计划" },
      { id: "dev", agent: "fullstack_dev", label: "全栈开发" },
      { id: "test", agent: "test", label: "测试" },
      { id: "ops", agent: "ops", label: "运维" },
    ]),
    dify: {},
  },
  {
    id: "full-delivery-with-review",
    name: "全流程交付（澄清 + 评审）",
    description:
      "草稿 → 澄清 → 定稿 → 计划 → 开发 → 评审 → 测试 → 运维；评审驳回可回到开发。",
    enabled: true,
    tags: ["default", "delivery", "review"],
    source: { kind: "template", template_id: "full-delivery-with-review" },
    defaults: { human_approval: true, on_reject: "end" },
    steps: linearSteps([
      { id: "intake", agent: "requirement_intake", label: "需求草稿" },
      { id: "clarify", agent: "requirement_clarify", label: "需求澄清" },
      { id: "requirement", agent: "requirement", label: "需求定稿" },
      { id: "plan", agent: "plan", label: "计划" },
      { id: "dev", agent: "fullstack_dev", label: "全栈开发" },
      {
        id: "review",
        agent: "code_review",
        label: "代码评审",
        on_reject: "goto",
        reject_goto: "dev",
      },
      { id: "test", agent: "test", label: "测试" },
      { id: "ops", agent: "ops", label: "运维" },
    ]),
    dify: {},
  },
];

/** Rule-based NL → pipeline draft (no LLM required). */
export function composePipelineFromPrompt(prompt: string): PipelineCreate {
  const text = prompt.trim();
  const lower = text.toLowerCase();

  if (/生产|production|prod/.test(lower) && /发布|部署|上线/.test(text)) {
    throw new Error("不允许通过自然语言开启生产发布，请仅使用 staging 运维步骤");
  }

  const wantClarify = /澄清|澄清需求|缺口/.test(text);
  const wantReview = /评审|code review|审查/.test(text);
  const wantOps = !/不要.*发布|跳过.*运维|不部署/.test(text);
  const wantTest = !/跳过.*测试|不要测试/.test(text);

  if (wantClarify || wantReview) {
    const base = structuredClone(
      DEFAULT_PIPELINES.find((p) => p.id === "full-delivery-with-review")!,
    );
    let steps = base.steps;
    if (!wantClarify) {
      steps = steps.filter((s) => s.id !== "intake" && s.id !== "clarify");
      if (steps[0]) steps[0].inputs_from = [];
    }
    if (!wantReview) {
      steps = steps.filter((s) => s.id !== "review");
    }
    if (!wantTest) steps = steps.filter((s) => s.id !== "test");
    if (!wantOps) steps = steps.filter((s) => s.id !== "ops");
    // rebuild inputs_from linearly
    steps = steps.map((s, i) => ({
      ...s,
      inputs_from: i === 0 ? [] : [steps[i - 1].id],
    }));
    return PipelineCreateSchema.parse({
      ...base,
      id: `nl-${Date.now().toString(36)}`,
      name: text.slice(0, 40) || base.name,
      description: `由自然语言生成：${text}`,
      source: { kind: "nl", nl_prompt: text, template_id: base.id },
      steps,
      dify: base.dify || {},
    });
  }

  const base = structuredClone(
    DEFAULT_PIPELINES.find((p) => p.id === "standard-delivery")!,
  );
  let steps = base.steps;
  if (!wantTest) steps = steps.filter((s) => s.id !== "test");
  if (!wantOps) steps = steps.filter((s) => s.id !== "ops");
  steps = steps.map((s, i) => ({
    ...s,
    inputs_from: i === 0 ? [] : [steps[i - 1].id],
  }));
  return PipelineCreateSchema.parse({
    ...base,
    id: `nl-${Date.now().toString(36)}`,
    name: text.slice(0, 40) || base.name,
    description: `由自然语言生成：${text}`,
    source: { kind: "nl", nl_prompt: text, template_id: base.id },
    steps,
    dify: base.dify || {},
  });
}
