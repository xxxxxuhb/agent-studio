import {
  applyStudioDecision,
  applyStudioEvent,
  createHttpBridgeClient,
  resumeStudioRun,
  startStudioRun,
  type OrchestratorOutcome,
  type OrchestratorStep,
  type StudioRunState,
} from "@agent-studio/orchestrator";
import type {
  DigitalHuman,
  WorkOrder,
  WorkOrderRunStep,
} from "@agent-studio/agent-schema";
import { bridgeHttpToken } from "../bridges/bridge-http";

export function toOrchestratorSteps(
  steps: WorkOrderRunStep[],
): OrchestratorStep[] {
  return steps.map((s) => ({
    step_id: s.step_id,
    agent: s.agent,
    label: s.label,
    kind: s.kind || "agent",
    human_approval: Boolean(s.human_approval),
    on_reject: s.on_reject,
    reject_goto: s.reject_goto,
    parallel: s.parallel,
    http: s.http,
    wait_event: s.wait_event,
    ci: s.ci,
    delay: s.delay,
  }));
}

export function agentLookup(humans: DigitalHuman[]) {
  const map = new Map(humans.map((h) => [h.id, h]));
  return {
    get(agentId: string) {
      return map.get(agentId);
    },
  };
}

export function makeBridgeClient(baseUrl: string) {
  return createHttpBridgeClient({
    baseUrl,
    token: bridgeHttpToken(),
  });
}

export function buildRawRequirement(order: WorkOrder): string {
  return [
    `【工单】${order.title} (${order.id})`,
    `【Studio run】${order.run?.run_id || "-"}`,
    order.project_id ? `【Studio 项目】${order.project_id}` : "",
    "",
    order.requirement,
  ]
    .filter(Boolean)
    .join("\n");
}

function templateContext(order: WorkOrder) {
  return {
    work_order_id: order.id,
    run_id: order.run?.run_id,
    title: order.title,
    raw_requirement: buildRawRequirement(order),
  };
}

/**
 * Progress hints written by the API purely for the UI. The orchestrator would
 * otherwise replay them as the previous stage result when a decision/event
 * finishes the pipeline, overwriting the real step summary/output.
 */
const TRANSIENT_SUMMARY =
  /^(Studio 编排启动中…|已提交 (approve|reject)，继续编排中…|事件 .+ 已到达，继续中…)$/;

export function isTransientSummary(text?: string | null): boolean {
  return TRANSIENT_SUMMARY.test((text || "").trim());
}

function carrySummary(text?: string | null): string {
  return isTransientSummary(text) ? "" : text || "";
}

export function studioStateFromOutcome(
  outcome: OrchestratorOutcome,
  bridgeBaseUrl: string,
): StudioRunState {
  return {
    ...outcome.state,
    bridge_base_url: outcome.state.bridge_base_url || bridgeBaseUrl,
    bridge_run_id: outcome.state.bridge_run_id || "",
    current_stage: outcome.state.current_stage || "",
    last_summary: outcome.state.last_summary || "",
    pending_human: Boolean(outcome.state.pending_human),
    dry_run: Boolean(outcome.state.dry_run),
    status: outcome.state.status || outcome.kind,
    error: outcome.state.error ?? null,
  };
}

export async function runStudioStart(opts: {
  order: WorkOrder;
  bridgeBaseUrl: string;
  agentsMdPath: string;
  routingMode: "auto" | "explicit";
  humans: DigitalHuman[];
  autoApprove: boolean;
  onProgress?: Parameters<typeof startStudioRun>[0]["onProgress"];
  inbox_files?: Parameters<typeof startStudioRun>[0]["inbox_files"];
}): Promise<OrchestratorOutcome> {
  const run = opts.order.run;
  const steps = toOrchestratorSteps(run?.steps || []);
  const ctx = templateContext(opts.order);
  const inboxNote =
    opts.inbox_files?.length
      ? `\n\n【附件】已注入工作区 docs/runs/<bridge_run_id>/inbox/（共 ${opts.inbox_files.length} 个）：\n${opts.inbox_files.map((f) => `- ${f.name}`).join("\n")}`
      : "";
  return startStudioRun({
    bridge: makeBridgeClient(opts.bridgeBaseUrl),
    steps,
    agents: agentLookup(opts.humans),
    agents_md_path: opts.agentsMdPath,
    raw_requirement: ctx.raw_requirement + inboxNote,
    routing_mode: opts.routingMode,
    bridge_base_url: opts.bridgeBaseUrl,
    auto_approve: opts.autoApprove,
    entry: run?.entry,
    edges: run?.edges,
    work_order_id: ctx.work_order_id,
    run_id: ctx.run_id,
    title: ctx.title,
    onProgress: opts.onProgress,
    inbox_files: opts.inbox_files,
  });
}

export async function runStudioDecision(opts: {
  order: WorkOrder;
  decision: "approve" | "reject";
  feedback?: string;
  humans: DigitalHuman[];
  onProgress?: Parameters<typeof applyStudioDecision>[0]["onProgress"];
  inbox_files?: Parameters<typeof applyStudioDecision>[0]["inbox_files"];
}): Promise<OrchestratorOutcome> {
  const run = opts.order.run;
  if (!run?.studio?.bridge_run_id) {
    throw new Error("missing studio.bridge_run_id");
  }
  const bridgeBaseUrl =
    run.studio.bridge_base_url || "http://127.0.0.1:8787";
  const ctx = templateContext(opts.order);
  return applyStudioDecision({
    bridge: makeBridgeClient(bridgeBaseUrl),
    steps: toOrchestratorSteps(run.steps || []),
    agents: agentLookup(opts.humans),
    state: {
      bridge_run_id: run.studio.bridge_run_id,
      bridge_base_url: bridgeBaseUrl,
      current_stage: run.studio.current_stage,
      last_summary: carrySummary(run.studio.last_summary),
      pending_human: run.studio.pending_human,
      dry_run: run.studio.dry_run,
      status: run.studio.status,
      error: run.studio.error ?? null,
    },
    current_step_index: run.current_step_index ?? 0,
    decision: opts.decision,
    feedback: opts.feedback,
    auto_approve: Boolean(run.auto_approve),
    entry: run.entry,
    edges: run.edges,
    work_order_id: ctx.work_order_id,
    run_id: ctx.run_id,
    title: ctx.title,
    raw_requirement: ctx.raw_requirement,
    onProgress: opts.onProgress,
    inbox_files: opts.inbox_files,
  });
}

/** Resume failed step on existing Bridge run (no createRun). */
export async function runStudioResume(opts: {
  order: WorkOrder;
  feedback?: string;
  humans: DigitalHuman[];
  onProgress?: Parameters<typeof resumeStudioRun>[0]["onProgress"];
  inbox_files?: Parameters<typeof resumeStudioRun>[0]["inbox_files"];
}): Promise<OrchestratorOutcome> {
  const run = opts.order.run;
  if (!run?.studio?.bridge_run_id) {
    throw new Error("missing studio.bridge_run_id");
  }
  const bridgeBaseUrl =
    run.studio.bridge_base_url || "http://127.0.0.1:8787";
  const failedIdx = run.steps.findIndex((s) => s.status === "failed");
  const stepIndex =
    failedIdx >= 0 ? failedIdx : (run.current_step_index ?? 0);
  const ctx = templateContext(opts.order);
  return resumeStudioRun({
    bridge: makeBridgeClient(bridgeBaseUrl),
    steps: toOrchestratorSteps(run.steps || []),
    agents: agentLookup(opts.humans),
    state: {
      bridge_run_id: run.studio.bridge_run_id,
      bridge_base_url: bridgeBaseUrl,
      current_stage: run.studio.current_stage,
      last_summary: carrySummary(run.studio.last_summary),
      pending_human: false,
      dry_run: run.studio.dry_run,
      status: "running",
      error: null,
    },
    current_step_index: stepIndex,
    feedback: opts.feedback,
    auto_approve: Boolean(run.auto_approve),
    entry: run.entry,
    edges: run.edges,
    work_order_id: ctx.work_order_id,
    run_id: ctx.run_id,
    title: ctx.title,
    raw_requirement: ctx.raw_requirement,
    onProgress: opts.onProgress,
    inbox_files: opts.inbox_files,
  });
}

/** Advance a wait_event step when Forge/manual event arrives. */
export async function runStudioEvent(opts: {
  order: WorkOrder;
  event: "mr_merged" | "issue_labeled" | "manual";
  labels?: string[];
  feedback?: string;
  humans: DigitalHuman[];
  onProgress?: Parameters<typeof applyStudioEvent>[0]["onProgress"];
}): Promise<OrchestratorOutcome> {
  const run = opts.order.run;
  if (!run?.studio?.bridge_run_id) {
    throw new Error("missing studio.bridge_run_id");
  }
  const bridgeBaseUrl =
    run.studio.bridge_base_url || "http://127.0.0.1:8787";
  const ctx = templateContext(opts.order);
  return applyStudioEvent({
    bridge: makeBridgeClient(bridgeBaseUrl),
    steps: toOrchestratorSteps(run.steps || []),
    agents: agentLookup(opts.humans),
    state: {
      bridge_run_id: run.studio.bridge_run_id,
      bridge_base_url: bridgeBaseUrl,
      current_stage: run.studio.current_stage,
      last_summary: carrySummary(run.studio.last_summary),
      pending_human: false,
      dry_run: run.studio.dry_run,
      status: "running",
      error: null,
    },
    current_step_index: run.current_step_index ?? 0,
    event: opts.event,
    labels: opts.labels,
    feedback: opts.feedback,
    auto_approve: Boolean(run.auto_approve),
    entry: run.entry,
    edges: run.edges,
    work_order_id: ctx.work_order_id,
    run_id: ctx.run_id,
    title: ctx.title,
    raw_requirement: ctx.raw_requirement,
    onProgress: opts.onProgress,
  });
}
