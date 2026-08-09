import type { DigitalHuman, StudioLanguage, WorkOrder, WorkOrderRunStep } from "@agent-studio/agent-schema";

type Ctx = {
  title: string;
  agentName: string;
  role: string;
  req: string;
  order: WorkOrder;
  step: WorkOrderRunStep;
  agent?: DigitalHuman | null;
};

function headerZh(c: Ctx) {
  return [
    `# ${c.title}`,
    "",
    `- 数字人：${c.agentName} (\`${c.step.agent}\`)`,
    `- 角色：${c.role}`,
    `- 工单：${c.order.title} (\`${c.order.id}\`)`,
    `- Run：${c.order.run?.run_id || "-"}`,
    `- 语言：中文`,
    "",
  ].join("\n");
}

function headerEn(c: Ctx) {
  return [
    `# ${c.title}`,
    "",
    `- Agent: ${c.agentName} (\`${c.step.agent}\`)`,
    `- Role: ${c.role}`,
    `- Work order: ${c.order.title} (\`${c.order.id}\`)`,
    `- Run: ${c.order.run?.run_id || "-"}`,
    `- Language: English`,
    "",
  ].join("\n");
}

function bodyZh(c: Ctx): string {
  const { req, agent, order, title } = c;
  switch (c.role) {
    case "intake":
      return [
        "## 需求草稿",
        "",
        "### 背景",
        req,
        "",
        "### 目标",
        "- （待澄清）明确可交付范围与验收标准",
        "",
        "### 非目标",
        "- 生产发布",
        "",
        "### 待确认问题",
        "1. 优先级与截止日期？",
        "2. 涉及前后端哪些仓库？",
      ].join("\n");
    case "clarify":
      return [
        "## 澄清纪要",
        "",
        "### 缺口",
        "- 验收标准不够具体",
        "- 边界条件未写清",
        "",
        "### 建议默认假设（需人工确认）",
        "- 仅测试环境",
        "- 不改数据库 schema，除非需求明确要求",
        "",
        "### 原始需求摘录",
        "```",
        req.slice(0, 500),
        "```",
      ].join("\n");
    case "spec":
      return [
        "## 需求定稿",
        "",
        "### 功能说明",
        req,
        "",
        "### 验收标准",
        "- [ ] 主流程可演示",
        "- [ ] 关键用例有说明",
        "- [ ] 文档已更新",
        "",
        "### 开放问题",
        "- 无（若有请在确认时补充）",
      ].join("\n");
    case "plan":
      return [
        "## 实施计划",
        "",
        "### 技术方案",
        "- 按现有技术栈小步改动",
        "",
        "### 任务拆解",
        "1. 梳理入口与依赖",
        "2. 实现核心改动",
        "3. 补充测试 / 文档",
        "",
        "### 风险",
        "- 环境配置缺失",
        "",
        "### 关联需求",
        req.slice(0, 300),
      ].join("\n");
    case "implement":
      return [
        "## 开发摘要",
        "",
        "### 改动说明（模拟）",
        "- 已按计划完成核心实现草稿",
        "- 真实改仓需接入 Bridge / Cursor",
        "",
        "### 建议验证",
        "```bash",
        "# 示例",
        "npm test",
        "```",
        "",
        "### 残留风险",
        "- 未跑完整回归",
      ].join("\n");
    case "review":
      return [
        "## 代码评审报告",
        "",
        "### 结论",
        "- 建议：有条件通过（模拟）",
        "",
        "### 问题分级",
        "- blocker：无",
        "- major：建议补充边界测试",
        "- nit：命名可再统一",
        "",
        "### 审查范围",
        `- 对照工单「${order.title}」与计划`,
        "",
        "### 提交策略",
        agent?.permissions?.may_commit
          ? "- 无 blocker → 评审完成后立即 commit + push，并开合并 PR"
          : "- 本 Agent 未授权提交（may_commit=false）",
      ].join("\n");
    case "verify":
      return [
        "## 测试报告",
        "",
        "### 结果（模拟）",
        "- lint：通过",
        "- unit：通过",
        "- e2e：未配置则跳过",
        "",
        "### 失败项",
        "- 无",
        "",
        "### 建议",
        "- 合入前再跑一次完整 suite",
      ].join("\n");
    case "ops":
      return [
        "## 测试环境发布说明",
        "",
        "### 部署（模拟）",
        "- target：staging",
        "- production：disabled",
        "",
        "### Smoke",
        "- health check：通过（模拟）",
        "",
        "### 回滚要点",
        "- 回退到上一版本镜像 / 上一 commit",
      ].join("\n");
    default:
      return [
        "## Agent 产出",
        "",
        agent?.description || "（无描述）",
        "",
        "### 职责",
        ...(agent?.responsibilities || []).map((r) => `- ${r}`),
        "",
        "### 输入需求",
        "```",
        req.slice(0, 500),
        "```",
      ].join("\n");
  }
}

function bodyEn(c: Ctx): string {
  const { req, agent, order, title } = c;
  switch (c.role) {
    case "intake":
      return [
        "## Requirement draft",
        "",
        "### Background",
        req,
        "",
        "### Goals",
        "- (TBD) Clarify deliverable scope and acceptance criteria",
        "",
        "### Non-goals",
        "- Production release",
        "",
        "### Open questions",
        "1. Priority and deadline?",
        "2. Which frontend/backend repos are involved?",
      ].join("\n");
    case "clarify":
      return [
        "## Clarification notes",
        "",
        "### Gaps",
        "- Acceptance criteria are too vague",
        "- Edge cases are unclear",
        "",
        "### Proposed defaults (need human approval)",
        "- Staging only",
        "- No DB schema changes unless explicitly required",
        "",
        "### Requirement excerpt",
        "```",
        req.slice(0, 500),
        "```",
      ].join("\n");
    case "spec":
      return [
        "## Finalized requirements",
        "",
        "### Feature description",
        req,
        "",
        "### Acceptance criteria",
        "- [ ] Main flow is demoable",
        "- [ ] Exception cases are documented",
        "- [ ] Docs are updated",
        "",
        "### Open issues",
        "- None (add during approval if needed)",
      ].join("\n");
    case "plan":
      return [
        "## Implementation plan",
        "",
        "### Technical approach",
        "- Small, incremental changes on the current stack",
        "",
        "### Task breakdown",
        "1. Map entry points and dependencies",
        "2. Implement core changes",
        "3. Add tests / docs",
        "",
        "### Risks",
        "- Missing environment configuration",
        "",
        "### Related requirement",
        req.slice(0, 300),
      ].join("\n");
    case "implement":
      return [
        "## Development summary",
        "",
        "### Changes (simulated)",
        "- Core implementation draft completed per plan",
        "- Real repo edits require Bridge / Cursor",
        "",
        "### Suggested verification",
        "```bash",
        "# example",
        "npm test",
        "```",
        "",
        "### Residual risks",
        "- Full regression not run",
      ].join("\n");
    case "review":
      return [
        "## Code review report",
        "",
        "### Verdict",
        "- Conditionally approve (simulated)",
        "",
        "### Findings",
        "- blocker: none",
        "- major: add edge-case tests",
        "- nit: naming consistency",
        "",
        "### Scope",
        `- Against work order 「${order.title}」 and the plan`,
        "",
        "### Commit policy",
        agent?.permissions?.may_commit
          ? "- No blockers → commit + push + open merge PR immediately after review"
          : "- This agent is not allowed to commit (may_commit=false)",
      ].join("\n");
    case "verify":
      return [
        "## Test report",
        "",
        "### Results (simulated)",
        "- lint: pass",
        "- unit: pass",
        "- e2e: skipped if not configured",
        "",
        "### Failures",
        "- none",
        "",
        "### Recommendation",
        "- Re-run the full suite before merge",
      ].join("\n");
    case "ops":
      return [
        "## Staging release notes",
        "",
        "### Deploy (simulated)",
        "- target: staging",
        "- production: disabled",
        "",
        "### Smoke",
        "- health check: pass (simulated)",
        "",
        "### Rollback",
        "- revert to previous image / commit",
      ].join("\n");
    default:
      return [
        "## Agent output",
        "",
        agent?.description || "(no description)",
        "",
        "### Responsibilities",
        ...(agent?.responsibilities || []).map((r) => `- ${r}`),
        "",
        "### Input requirement",
        "```",
        req.slice(0, 500),
        "```",
      ].join("\n");
  }
}

/** Build readable stub artifacts until real Dify/Bridge agents are wired. */
export function buildAgentOutput(opts: {
  order: WorkOrder;
  step: WorkOrderRunStep;
  agent?: DigitalHuman | null;
  language?: StudioLanguage;
  commitAppendix?: string;
}): { summary: string; output_title: string; output: string } {
  const language = opts.language || "zh";
  const { order, step, agent } = opts;
  const ctx: Ctx = {
    title: step.label || step.step_id,
    agentName: agent?.name || step.agent,
    role: agent?.role || "unknown",
    req: order.requirement.trim(),
    order,
    step,
    agent,
  };

  const header = language === "en" ? headerEn(ctx) : headerZh(ctx);
  const body = language === "en" ? bodyEn(ctx) : bodyZh(ctx);
  const footer =
    language === "en"
      ? "\n\n---\n> Studio simulated output. Replaced by real Agent results after Dify/Bridge is connected.\n"
      : "\n\n---\n> 当前为 Studio 模拟产出，接入 Dify/Bridge 后将替换为真实 Agent 结果。\n";

  const committed =
    Boolean(opts.commitAppendix) && agent?.role === "review" && agent.permissions.may_commit;
  const summary =
    language === "en"
      ? committed
        ? `${ctx.agentName} finished 「${ctx.title}」 and committed. Full output below.`
        : `${ctx.agentName} finished 「${ctx.title}」. Full output below.`
      : committed
        ? `${ctx.agentName} 已完成「${ctx.title}」并已提交代码，可在下方查看完整产出`
        : `${ctx.agentName} 已完成「${ctx.title}」，可在下方查看完整产出`;

  return {
    summary,
    output_title: `${ctx.title} · ${ctx.agentName}`,
    output: `${header}${body}${opts.commitAppendix || ""}${footer}`,
  };
}

/** Instruction appended to Dify/Bridge requirements so agents honor the language. */
export function languageDirective(language: StudioLanguage): string {
  if (language === "en") {
    return [
      "【Output language】",
      "Produce ALL agent narratives, reports, summaries, and user-facing text in English.",
      "Keep code identifiers and file paths unchanged.",
    ].join("\n");
  }
  return [
    "【输出语言】",
    "请用中文生成全部 Agent 叙述、报告、摘要与面向用户的文本。",
    "代码标识符与文件路径保持原样，不要翻译。",
  ].join("\n");
}

/** Instruct Bridge / review agent: pass → review commits/pushes; Bridge opens PR. */
export function reviewCommitDirective(language: StudioLanguage): string {
  if (language === "en") {
    return [
      "【Dev branch → review → commit/push → Bridge PR】",
      "fullstack_dev must implement only on the feature/dev branch (Bridge creates studio/dev/{run_id}); do NOT commit or push during dev.",
      "code_review must: (1) review the branch diff; (2) if blockers = 0, YOU git commit + push origin on that branch and write commit-record.md; (3) if blockers > 0, reject and do NOT commit/push.",
      "Do not modify business code during review. Do NOT open the merge PR/MR — Bridge opens it from commit-record.md.",
    ].join("\n");
  }
  return [
    "【开发分支 → 评审 → 提交推送 → Bridge 开 PR】",
    "全栈开发 Agent 必须只在开发分支上改代码（Bridge 会创建 studio/dev/{run_id}）；开发阶段禁止 commit / push。",
    "代码评审 Agent：① 审查分支改动；② blocker=0 时自行在该分支 git commit + push origin，并写 commit-record.md；③ 有 blocker 则打回且禁止提交推送。",
    "评审阶段禁止自行修补业务代码。不要开合并 PR/MR——由 Bridge 根据 commit-record 创建。",
  ].join("\n");
}

export function formatCommitAppendix(opts: {
  language: StudioLanguage;
  branch: string;
  commitSha: string;
  message: string;
  simulated?: boolean;
}): string {
  const { language, branch, commitSha, message, simulated } = opts;
  if (language === "en") {
    return [
      "",
      "## Commit",
      "",
      `- status: committed${simulated ? " (simulated)" : ""}`,
      `- branch: \`${branch}\``,
      `- commit: \`${commitSha}\``,
      `- message: ${message}`,
      "",
      "> Review passed with no blockers → changes were committed.",
    ].join("\n");
  }
  return [
    "",
    "## 代码提交",
    "",
    `- 状态：已提交${simulated ? "（本地模拟）" : ""}`,
    `- 分支：\`${branch}\``,
    `- commit：\`${commitSha}\``,
    `- message：${message}`,
    "",
    "> 评审通过且无 blocker → 已执行提交。",
  ].join("\n");
}
