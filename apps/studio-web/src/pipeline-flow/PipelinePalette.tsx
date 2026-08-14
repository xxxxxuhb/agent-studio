import type { PipelineStepKind } from "@agent-studio/agent-schema";

export const PIPELINE_DND_MIME = "application/x-agent-studio-pipeline-node";

export const FLOW_START_ID = "__flow_start__";
export const FLOW_END_ID = "__flow_end__";

export type PipelinePaletteDragPayload =
  | { kind: "terminal"; terminal: "start" | "end" }
  | { kind: "agent"; agent?: string; label?: string }
  | { kind: "http" }
  | { kind: "ci" }
  | { kind: "wait_event" }
  | { kind: "delay" }
  | { kind: "condition" }
  | { kind: "parallel" }
  | { kind: "cron_trigger" };

export const TERMINAL_MATERIALS: Array<{
  terminal: "start" | "end";
  title: string;
  desc: string;
  accent: string;
}> = [
  {
    terminal: "start",
    title: "开始",
    desc: "流程入口",
    accent: "#1677ff",
  },
  {
    terminal: "end",
    title: "结束",
    desc: "流程出口",
    accent: "#52c41a",
  },
];

/** 网关 + 时间类物料（拖到画布） */
export const CONTROL_MATERIALS: Array<{
  payload: Exclude<
    PipelinePaletteDragPayload,
    { kind: "terminal" } | { kind: "agent" } | { kind: "cron_trigger" }
  >;
  title: string;
  desc: string;
  accent: string;
}> = [
  {
    payload: { kind: "condition" },
    title: "条件网关",
    desc: "出边写条件，点边配置",
    accent: "#fa8c16",
  },
  {
    payload: { kind: "parallel" },
    title: "并行网关",
    desc: "多路并行后汇合",
    accent: "#13c2c2",
  },
  {
    payload: { kind: "wait_event" },
    title: "等待事件",
    desc: "等 MR 合并 / 标签",
    accent: "#36cfc9",
  },
  {
    payload: { kind: "delay" },
    title: "延时",
    desc: "等待 N 秒再继续",
    accent: "#597ef7",
  },
];

export const STEP_KIND_MATERIALS: Array<{
  kind: Extract<PipelineStepKind, "agent" | "http" | "ci">;
  title: string;
  desc: string;
  accent: string;
}> = [
  {
    kind: "agent",
    title: "Agent",
    desc: "Bridge 阶段 / 数字人",
    accent: "#1677ff",
  },
  {
    kind: "http",
    title: "HTTP",
    desc: "外部 HTTP 请求",
    accent: "#722ed1",
  },
  {
    kind: "ci",
    title: "CI",
    desc: "触发并轮询 CI",
    accent: "#2f54eb",
  },
];

type AgentOption = { value: string; label: string };

type Props = {
  agentOptions: AgentOption[];
};

function onMaterialDragStart(
  event: React.DragEvent,
  payload: PipelinePaletteDragPayload,
) {
  event.dataTransfer.setData(PIPELINE_DND_MIME, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "copy";
}

export function PipelinePalette({ agentOptions }: Props) {
  return (
    <aside className="pipeline-flow-palette">
      <div className="pipeline-flow-palette__title">物料</div>
      <div className="pipeline-flow-palette__hint">拖到画布 · 手柄连线</div>

      <div className="pipeline-flow-palette__section">流程</div>
      <div className="pipeline-flow-palette__list">
        {TERMINAL_MATERIALS.map((m) => (
          <div
            key={m.terminal}
            className={`pipeline-flow-palette__item pipeline-flow-palette__item--terminal-${m.terminal}`}
            draggable
            onDragStart={(e) =>
              onMaterialDragStart(e, { kind: "terminal", terminal: m.terminal })
            }
            style={{ borderLeftColor: m.accent }}
          >
            <div className="pipeline-flow-palette__item-title">{m.title}</div>
            <div className="pipeline-flow-palette__item-desc">{m.desc}</div>
          </div>
        ))}
      </div>

      <div className="pipeline-flow-palette__section">网关 / 时间</div>
      <div className="pipeline-flow-palette__list">
        {CONTROL_MATERIALS.map((m) => (
          <div
            key={m.title}
            className="pipeline-flow-palette__item"
            draggable
            onDragStart={(e) => onMaterialDragStart(e, m.payload)}
            style={{ borderLeftColor: m.accent }}
          >
            <div className="pipeline-flow-palette__item-title">{m.title}</div>
            <div className="pipeline-flow-palette__item-desc">{m.desc}</div>
          </div>
        ))}
        <div
          className="pipeline-flow-palette__item"
          draggable
          onDragStart={(e) => onMaterialDragStart(e, { kind: "cron_trigger" })}
          style={{ borderLeftColor: "#eb2f96" }}
        >
          <div className="pipeline-flow-palette__item-title">定时</div>
          <div className="pipeline-flow-palette__item-desc">
            Cron 触发器（流水线级）
          </div>
        </div>
      </div>

      <div className="pipeline-flow-palette__section">执行</div>
      <div className="pipeline-flow-palette__list">
        {STEP_KIND_MATERIALS.map((m) => (
          <div
            key={m.kind}
            className="pipeline-flow-palette__item"
            draggable
            onDragStart={(e) => onMaterialDragStart(e, { kind: m.kind })}
            style={{ borderLeftColor: m.accent }}
          >
            <div className="pipeline-flow-palette__item-title">{m.title}</div>
            <div className="pipeline-flow-palette__item-desc">{m.desc}</div>
          </div>
        ))}
      </div>

      <div className="pipeline-flow-palette__section">数字人</div>
      <div className="pipeline-flow-palette__list pipeline-flow-palette__list--agents">
        {agentOptions.length ? (
          agentOptions.map((a) => (
            <div
              key={a.value}
              className="pipeline-flow-palette__item pipeline-flow-palette__item--agent"
              draggable
              title={a.label}
              onDragStart={(e) =>
                onMaterialDragStart(e, {
                  kind: "agent",
                  agent: a.value,
                  label: a.label.split(" (")[0] || a.value,
                })
              }
            >
              <div className="pipeline-flow-palette__item-title">@{a.value}</div>
              <div className="pipeline-flow-palette__item-desc">{a.label}</div>
            </div>
          ))
        ) : (
          <div className="pipeline-flow-palette__empty">暂无可用数字人</div>
        )}
      </div>
    </aside>
  );
}

export function parsePaletteDrag(
  event: React.DragEvent,
): PipelinePaletteDragPayload | null {
  const raw = event.dataTransfer.getData(PIPELINE_DND_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PipelinePaletteDragPayload;
    if (!parsed?.kind) return null;
    return parsed;
  } catch {
    return null;
  }
}
