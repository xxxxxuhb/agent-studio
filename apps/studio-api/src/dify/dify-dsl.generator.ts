import { randomUUID } from "node:crypto";
import YAML from "yaml";
import type { DigitalHuman, Pipeline } from "@agent-studio/agent-schema";
import { bridgeStageForAgent as mapBridgeStage } from "@agent-studio/orchestrator";

type GraphEdge = Record<string, unknown>;
type GraphNode = Record<string, unknown>;

const EDGE_META = {
  isInIteration: false,
  isInLoop: false,
};

/** Map Studio agent → Bridge `/runs/:id/:stage` path segment. */
export function bridgeStageForAgent(agent: DigitalHuman | null, agentId: string): string {
  return mapBridgeStage(agent, agentId);
}

function edge(
  id: string,
  source: string,
  target: string,
  sourceType: string,
  targetType: string,
  sourceHandle = "source",
): GraphEdge {
  return {
    id,
    source,
    sourceHandle,
    target,
    targetHandle: "target",
    type: "custom",
    data: { sourceType, targetType, ...EDGE_META },
  };
}

function httpNode(opts: {
  id: string;
  title: string;
  url: string;
  x: number;
  y: number;
  readTimeout?: number;
}): GraphNode {
  return {
    id: opts.id,
    type: "custom",
    position: { x: opts.x, y: opts.y },
    data: {
      type: "http-request",
      title: opts.title,
      method: "POST",
      url: opts.url,
      // Prefer Dify Bearer auth slot so {{bridge_token}} is substituted reliably.
      // Also send X-Bridge-Token (Bridge accepts either) in case Authorization is dropped.
      authorization: {
        type: "api-key",
        config: {
          type: "bearer",
          api_key: "{{#start.bridge_token#}}",
        },
      },
      headers:
        "Content-Type:application/json\nX-Bridge-Token:{{#start.bridge_token#}}",
      params: "",
      body: {
        type: "json",
        data: [
          {
            key: "",
            type: "text",
            value: '{"feedback":""}',
          },
        ],
      },
      timeout: {
        connect: 10,
        read: opts.readTimeout ?? 1800,
        write: 60,
      },
    },
  };
}

function humanNode(opts: {
  id: string;
  title: string;
  formContent: string;
  x: number;
  y: number;
}): GraphNode {
  return {
    id: opts.id,
    type: "custom",
    position: { x: opts.x, y: opts.y },
    data: {
      type: "human-input",
      title: opts.title,
      form_content: opts.formContent,
      inputs: [],
      user_actions: [
        { id: "approve", title: "通过", button_style: "primary" },
        { id: "reject", title: "驳回", button_style: "default" },
      ],
      delivery_methods: [
        {
          id: randomUUID(),
          type: "webapp",
          enabled: true,
        },
      ],
      timeout: 3,
      timeout_unit: "day",
    },
  };
}

/**
 * Generate a Dify Workflow DSL (0.7.x style) from a Studio pipeline.
 * Pattern matches dify-pipeline `delivery-pipeline.dify.yml`:
 * start → create run → parse → [http stage → human]* → end
 */
export function generateDifyWorkflowDsl(opts: {
  pipeline: Pipeline;
  agents: Map<string, DigitalHuman>;
}): string {
  const { pipeline, agents } = opts;
  const edges: GraphEdge[] = [];
  const nodes: GraphNode[] = [];

  const x0 = 40;
  const yMain = 300;
  const yReject = 520;
  const dx = 280;

  nodes.push({
    id: "start",
    type: "custom",
    position: { x: x0, y: yMain },
    data: {
      type: "start",
      title: "开始",
      desc: `Studio 流水线 ${pipeline.id}`,
      variables: [
        {
          variable: "bridge_base_url",
          label: "Bridge 地址",
          type: "text-input",
          required: true,
          max_length: 200,
          default: "http://host.docker.internal:8787",
        },
        {
          variable: "bridge_token",
          label: "Bridge HTTP Token（与 STUDIO_BRIDGE_TOKEN 一致）",
          type: "text-input",
          required: false,
          max_length: 200,
          default: "",
        },
        {
          variable: "agents_md_path",
          label: "AGENTS.md（可留空，默认 auto）",
          type: "text-input",
          required: false,
          max_length: 500,
          default: "auto",
        },
        {
          variable: "routing_mode",
          label: "路由模式 auto|explicit",
          type: "text-input",
          required: false,
          max_length: 16,
          default: "auto",
        },
        {
          variable: "raw_requirement",
          label: "原始需求",
          type: "paragraph",
          required: true,
          max_length: 8000,
        },
        {
          variable: "language",
          label: "语言 zh/en",
          type: "text-input",
          required: false,
          max_length: 8,
          default: "zh",
        },
        {
          variable: "studio_pipeline_id",
          label: "Studio 流水线 ID",
          type: "text-input",
          required: false,
          max_length: 64,
          default: pipeline.id,
        },
      ],
    },
  });

  nodes.push(
    httpNode({
      id: "http_create",
      title: "Manager 创建 Run",
      url: "{{#start.bridge_base_url#}}/runs",
      x: x0 + dx,
      y: yMain,
      readTimeout: 600,
    }),
  );
  // Override create body to include requirement
  (nodes[nodes.length - 1].data as { body: { data: Array<{ value: string }> } }).body.data[0].value =
    '{"agents_md_path":"{{#start.agents_md_path#}}","raw_requirement":"{{#start.raw_requirement#}}","routing_mode":"{{#start.routing_mode#}}","language":"{{#start.language#}}","studio_pipeline_id":"{{#start.studio_pipeline_id#}}"}';

  nodes.push({
    id: "code_parse_create",
    type: "custom",
    position: { x: x0 + dx * 2, y: yMain },
    data: {
      type: "code",
      title: "解析 run_id",
      code_language: "python3",
      code: `
import json
def main(body: str) -> dict:
    data = json.loads(body)
    run = data.get("run") or {}
    manager = data.get("manager") or {}
    return {
        "run_id": run.get("id", ""),
        "summary": manager.get("summary", ""),
        "status_doc": (run.get("artifacts") or {}).get("status_doc", ""),
    }
`.trim(),
      variables: [{ variable: "body", value_selector: ["http_create", "body"] }],
      outputs: {
        run_id: { type: "string" },
        summary: { type: "string" },
        status_doc: { type: "string" },
      },
    },
  });

  edges.push(
    edge("e-start-create", "start", "http_create", "start", "http-request"),
  );
  edges.push(
    edge(
      "e-create-parse",
      "http_create",
      "code_parse_create",
      "http-request",
      "code",
    ),
  );

  nodes.push({
    id: "end_rejected",
    type: "custom",
    position: { x: x0 + dx * 3, y: yReject },
    data: {
      type: "end",
      title: "已驳回/超时",
      outputs: [
        {
          variable: "rejected_run_id",
          value_type: "string",
          value_selector: ["code_parse_create", "run_id"],
        },
        {
          variable: "hint",
          value_type: "string",
          value_selector: ["code_parse_create", "summary"],
        },
      ],
    },
  });

  const stepIndexById = new Map(pipeline.steps.map((s, i) => [s.id, i]));

  let connectFrom = "code_parse_create";
  let connectType = "code";
  let col = 3;
  let lastHttpId = "http_create";
  let pendingHumanApprove: string | null = null;

  for (const step of pipeline.steps) {
    const agent = agents.get(step.agent) || null;
    const stage = bridgeStageForAgent(agent, step.agent);
    const httpId = `http_${step.id}`;
    const humanId = `human_${step.id}`;
    const xHttp = x0 + dx * col;

    nodes.push(
      httpNode({
        id: httpId,
        title: `${step.label || step.id} (${stage})`,
        url: `{{#start.bridge_base_url#}}/runs/{{#code_parse_create.run_id#}}/${stage}`,
        x: xHttp,
        y: yMain,
      }),
    );

    if (pendingHumanApprove) {
      edges.push(
        edge(
          `e-${pendingHumanApprove}-approve`,
          pendingHumanApprove,
          httpId,
          "human-input",
          "http-request",
          "approve",
        ),
      );
      pendingHumanApprove = null;
    } else {
      edges.push(
        edge(
          `e-${connectFrom}-${httpId}`,
          connectFrom,
          httpId,
          connectType,
          "http-request",
        ),
      );
    }

    lastHttpId = httpId;

    if (step.human_approval) {
      const xHuman = x0 + dx * (col + 1);
      nodes.push(
        humanNode({
          id: humanId,
          title: `人工确认 · ${step.label || step.id}`,
          formContent: [
            `## ${step.label || step.id} 待确认`,
            `Studio 步骤：\`${step.id}\` · agent=\`${step.agent}\` · bridge stage=\`${stage}\``,
            `run_id: {{#code_parse_create.run_id#}}`,
            "",
            `HTTP 结果：{{#${httpId}.body#}}`,
          ].join("\n"),
          x: xHuman,
          y: yMain,
        }),
      );

      edges.push(
        edge(
          `e-${httpId}-${humanId}`,
          httpId,
          humanId,
          "http-request",
          "human-input",
        ),
      );

      let rejectTarget = "end_rejected";
      let rejectTargetType = "end";
      if (step.on_reject === "goto" && step.reject_goto) {
        const gotoIdx = stepIndexById.get(step.reject_goto);
        if (gotoIdx !== undefined) {
          rejectTarget = `http_${pipeline.steps[gotoIdx].id}`;
          rejectTargetType = "http-request";
        }
      }

      edges.push(
        edge(
          `e-${humanId}-reject`,
          humanId,
          rejectTarget,
          "human-input",
          rejectTargetType,
          "reject",
        ),
      );
      edges.push(
        edge(
          `e-${humanId}-timeout`,
          humanId,
          "end_rejected",
          "human-input",
          "end",
          "__timeout",
        ),
      );

      pendingHumanApprove = humanId;
      connectFrom = humanId;
      connectType = "human-input";
      col += 2;
    } else {
      connectFrom = httpId;
      connectType = "http-request";
      col += 1;
    }
  }

  if (pendingHumanApprove) {
    edges.push(
      edge(
        `e-${pendingHumanApprove}-approve`,
        pendingHumanApprove,
        "end_ok",
        "human-input",
        "end",
        "approve",
      ),
    );
  } else {
    edges.push(
      edge(`e-${connectFrom}-end`, connectFrom, "end_ok", connectType, "end"),
    );
  }

  nodes.push({
    id: "end_ok",
    type: "custom",
    position: { x: x0 + dx * (col + 1), y: yMain - 80 },
    data: {
      type: "end",
      title: "完成",
      outputs: [
        {
          variable: "run_id",
          value_type: "string",
          value_selector: ["code_parse_create", "run_id"],
        },
        {
          variable: "result",
          value_type: "string",
          value_selector: [lastHttpId, "body"],
        },
        {
          variable: "studio_pipeline_id",
          value_type: "string",
          value_selector: ["start", "studio_pipeline_id"],
        },
      ],
    },
  });

  const dsl = {
    version: "0.7.0",
    kind: "app",
    app: {
      name: pipeline.name,
      mode: "workflow",
      description:
        pipeline.description ||
        `由 Agent Studio 流水线「${pipeline.id}」生成；执行层走 Bridge。`,
      icon: "🛠️",
      icon_background: "#E3F2FD",
      icon_type: "emoji",
      use_icon_as_answer_icon: false,
    },
    dependencies: [],
    workflow: {
      conversation_variables: [],
      environment_variables: [],
      rag_pipeline_variables: [],
      features: {
        file_upload: { enabled: false },
        opening_statement: "",
        retriever_resource: { enabled: false },
        sensitive_word_avoidance: { enabled: false },
        speech_to_text: { enabled: false },
        suggested_questions: [],
        suggested_questions_after_answer: { enabled: false },
        text_to_speech: { enabled: false },
      },
      graph: {
        viewport: { x: 0, y: 0, zoom: 0.45 },
        edges,
        nodes,
      },
    },
  };

  return `# Generated by Agent Studio from pipeline ${pipeline.id}\n# Import into Dify: 工作室 → 创建应用 → 导入 DSL\n${YAML.stringify(dsl, { lineWidth: 120 })}`;
}
