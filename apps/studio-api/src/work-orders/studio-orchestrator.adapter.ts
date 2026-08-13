import {
  applyStudioDecision,
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
    human_approval: Boolean(s.human_approval),
    on_reject: s.on_reject,
    reject_goto: s.reject_goto,
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
}): Promise<OrchestratorOutcome> {
  const steps = toOrchestratorSteps(opts.order.run?.steps || []);
  return startStudioRun({
    bridge: makeBridgeClient(opts.bridgeBaseUrl),
    steps,
    agents: agentLookup(opts.humans),
    agents_md_path: opts.agentsMdPath,
    raw_requirement: buildRawRequirement(opts.order),
    routing_mode: opts.routingMode,
    bridge_base_url: opts.bridgeBaseUrl,
    auto_approve: opts.autoApprove,
    onProgress: opts.onProgress,
  });
}

export async function runStudioDecision(opts: {
  order: WorkOrder;
  decision: "approve" | "reject";
  feedback?: string;
  humans: DigitalHuman[];
  onProgress?: Parameters<typeof applyStudioDecision>[0]["onProgress"];
}): Promise<OrchestratorOutcome> {
  const run = opts.order.run;
  if (!run?.studio?.bridge_run_id) {
    throw new Error("missing studio.bridge_run_id");
  }
  const bridgeBaseUrl =
    run.studio.bridge_base_url || "http://127.0.0.1:8787";
  return applyStudioDecision({
    bridge: makeBridgeClient(bridgeBaseUrl),
    steps: toOrchestratorSteps(run.steps || []),
    agents: agentLookup(opts.humans),
    state: {
      bridge_run_id: run.studio.bridge_run_id,
      bridge_base_url: bridgeBaseUrl,
      current_stage: run.studio.current_stage,
      last_summary: run.studio.last_summary,
      pending_human: run.studio.pending_human,
      dry_run: run.studio.dry_run,
      status: run.studio.status,
      error: run.studio.error ?? null,
    },
    current_step_index: run.current_step_index ?? 0,
    decision: opts.decision,
    feedback: opts.feedback,
    auto_approve: Boolean(run.auto_approve),
    onProgress: opts.onProgress,
  });
}

/** Resume failed step on existing Bridge run (no createRun). */
export async function runStudioResume(opts: {
  order: WorkOrder;
  feedback?: string;
  humans: DigitalHuman[];
  onProgress?: Parameters<typeof resumeStudioRun>[0]["onProgress"];
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
  return resumeStudioRun({
    bridge: makeBridgeClient(bridgeBaseUrl),
    steps: toOrchestratorSteps(run.steps || []),
    agents: agentLookup(opts.humans),
    state: {
      bridge_run_id: run.studio.bridge_run_id,
      bridge_base_url: bridgeBaseUrl,
      current_stage: run.studio.current_stage,
      last_summary: run.studio.last_summary,
      pending_human: false,
      dry_run: run.studio.dry_run,
      status: "running",
      error: null,
    },
    current_step_index: stepIndex,
    feedback: opts.feedback,
    auto_approve: Boolean(run.auto_approve),
    onProgress: opts.onProgress,
  });
}
