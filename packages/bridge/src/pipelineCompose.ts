import os from "node:os";
import { resolveAgentDriver } from "@agent-studio/agent-runtime";

export type ComposeAgentInfo = {
  id: string;
  name: string;
  role: string;
  description?: string;
};

export type PipelineComposeDraft = {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  tags?: string[];
  source?: {
    kind?: "handwritten" | "template" | "nl";
    nl_prompt?: string;
    template_id?: string;
  };
  defaults?: {
    human_approval?: boolean;
    on_reject?: "end" | "retry_step" | "goto";
  };
  steps: Array<{
    id: string;
    agent: string;
    label: string;
    human_approval?: boolean;
    on_reject?: "end" | "retry_step" | "goto";
    reject_goto?: string;
    inputs_from?: string[];
  }>;
};

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function slugifyId(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  if (/^[a-z][a-z0-9_-]*$/.test(s) && s.length >= 2) return s.slice(0, 48);
  return `nl-${Date.now().toString(36)}`;
}

function buildPrompt(userPrompt: string, agents: ComposeAgentInfo[]): string {
  const catalog = agents
    .map(
      (a) =>
        `- id: ${a.id} | name: ${a.name} | role: ${a.role}${
          a.description ? ` | ${a.description.slice(0, 120)}` : ""
        }`,
    )
    .join("\n");

  return [
    "You are a pipeline composer for Agent Studio.",
    "Given a natural-language request, output ONE JSON object for a delivery pipeline.",
    "Output JSON only (no markdown prose outside JSON). A ```json fence is allowed.",
    "",
    "Hard rules:",
    "1. steps[].agent MUST be one of the agent ids listed below.",
    "2. Never include production deploy / production release. Ops may only mean staging/test.",
    "3. steps must be a non-empty array; use kebab-case ids like requirement, clarify, plan, dev, review, test, ops.",
    "4. Wire steps linearly via inputs_from (first step []).",
    "5. human_approval defaults to true; code_review reject may use on_reject=goto reject_goto=dev.",
    "6. id must match /^[a-z][a-z0-9_-]*$/ ; prefer short descriptive id.",
    "7. source.kind must be \"nl\"; put the user prompt in source.nl_prompt; source.template_id=\"agent\".",
    "",
    "JSON shape:",
    JSON.stringify(
      {
        id: "example-pipeline",
        name: "短名称",
        description: "说明",
        enabled: true,
        tags: ["nl"],
        source: { kind: "nl", nl_prompt: "...", template_id: "agent" },
        defaults: { human_approval: true, on_reject: "end" },
        steps: [
          {
            id: "requirement",
            agent: "requirement",
            label: "需求定稿",
            human_approval: true,
            on_reject: "end",
            inputs_from: [],
          },
        ],
      },
      null,
      2,
    ),
    "",
    "Available agents:",
    catalog || "(none)",
    "",
    "User request:",
    userPrompt.trim(),
  ].join("\n");
}

function normalizeDraft(
  raw: Record<string, unknown>,
  userPrompt: string,
  agents: ComposeAgentInfo[],
): PipelineComposeDraft {
  const agentIds = new Set(agents.map((a) => a.id));
  const stepsIn = Array.isArray(raw.steps) ? raw.steps : [];
  const steps: PipelineComposeDraft["steps"] = [];
  for (const item of stepsIn) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const agent = String(s.agent || "").trim();
    if (!agent || !agentIds.has(agent)) continue;
    const id = String(s.id || agent)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");
    if (!id) continue;
    steps.push({
      id,
      agent,
      label: String(s.label || agent),
      human_approval:
        typeof s.human_approval === "boolean" ? s.human_approval : true,
      on_reject:
        s.on_reject === "goto" || s.on_reject === "retry_step"
          ? s.on_reject
          : "end",
      reject_goto:
        typeof s.reject_goto === "string" ? s.reject_goto : undefined,
      inputs_from: Array.isArray(s.inputs_from)
        ? s.inputs_from.map(String)
        : [],
    });
  }
  if (!steps.length) {
    throw new Error("agent returned no valid steps for known agents");
  }
  // rebuild linear inputs_from
  const normalized = steps.map((s, i) => ({
    ...s,
    inputs_from: i === 0 ? [] : [steps[i - 1]!.id],
  }));

  const idRaw = String(raw.id || "").trim();
  const id = slugifyId(idRaw || `nl-${Date.now().toString(36)}`);
  return {
    id,
    name: String(raw.name || userPrompt.slice(0, 40) || id),
    description: String(
      raw.description || `由 Agent 生成：${userPrompt.trim()}`,
    ),
    enabled: raw.enabled !== false,
    tags: Array.isArray(raw.tags)
      ? raw.tags.map(String)
      : ["nl", "agent"],
    source: {
      kind: "nl",
      nl_prompt: userPrompt.trim(),
      template_id: "agent",
    },
    defaults: {
      human_approval: true,
      on_reject: "end",
    },
    steps: normalized,
  };
}

/**
 * Use the configured agent driver to compose a pipeline draft from NL.
 */
export async function composePipelineWithAgent(opts: {
  prompt: string;
  agents: ComposeAgentInfo[];
}): Promise<{
  draft: PipelineComposeDraft;
  raw_summary: string;
  driver: string;
  dryRun?: boolean;
}> {
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("prompt is required");
  if (!opts.agents.length) throw new Error("agents catalog is empty");

  const driver = resolveAgentDriver();
  const result = await driver.run({
    stage: "pipeline_compose",
    cwd: process.env.BRIDGE_COMPOSE_CWD || os.tmpdir(),
    prompt: buildPrompt(prompt, opts.agents),
    meta: { purpose: "pipeline_compose" },
  });

  const parsed = extractJsonObject(result.raw || result.summary || "");
  if (!parsed) {
    throw new Error(
      `agent did not return parseable JSON (driver=${result.driver})`,
    );
  }
  const draft = normalizeDraft(parsed, prompt, opts.agents);
  return {
    draft,
    raw_summary: (result.summary || "").slice(0, 2000),
    driver: result.driver,
    dryRun: result.dryRun,
  };
}
