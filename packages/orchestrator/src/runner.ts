import { bridgeStageForAgent } from "./stage-map";
import type {
  ApplyDecisionInput,
  OrchestratorOutcome,
  OrchestratorStep,
  StageResult,
  StartStudioRunInput,
  StudioRunState,
} from "./types";

function stepStage(
  step: OrchestratorStep,
  agents: StartStudioRunInput["agents"],
): string {
  return bridgeStageForAgent(agents.get(step.agent) || null, step.agent);
}

function stateFromStage(
  prev: StudioRunState,
  result: StageResult,
  extras?: Partial<StudioRunState>,
): StudioRunState {
  return {
    ...prev,
    bridge_run_id: result.runId || prev.bridge_run_id,
    current_stage: result.stage,
    last_summary: result.summary,
    pending_human: Boolean(result.pendingHumanApproval),
    dry_run: result.dryRun ?? prev.dry_run,
    status: result.status === "error" ? "failed" : prev.status,
    error: result.status === "error" ? result.summary : null,
    ...extras,
  };
}

function fail(
  state: StudioRunState,
  step_index: number,
  error: string,
  stage_result?: StageResult,
): OrchestratorOutcome {
  return {
    kind: "failed",
    state: { ...state, status: "failed", error },
    step_index,
    summary: error,
    error,
    stage_result,
  };
}

/**
 * After a stage succeeds: pause for human gate unless auto_approve / no gate.
 */
function afterStageSuccess(opts: {
  state: StudioRunState;
  step_index: number;
  step: OrchestratorStep;
  stage: string;
  result: StageResult;
  auto_approve?: boolean;
}): OrchestratorOutcome {
  const { state, step_index, step, stage, result, auto_approve } = opts;
  const nextState = stateFromStage(state, result, {
    status: "running",
    pending_human: Boolean(step.human_approval) && !auto_approve,
  });

  if (step.human_approval && !auto_approve) {
    return {
      kind: "pending_approval",
      state: { ...nextState, status: "pending_approval" },
      step_index,
      stage,
      summary: result.summary,
      stage_result: result,
    };
  }

  return {
    kind: "running",
    state: nextState,
    step_index,
    stage,
    summary: result.summary,
    stage_result: result,
  };
}

async function runStepAtIndex(
  input: {
    bridge: StartStudioRunInput["bridge"];
    steps: OrchestratorStep[];
    agents: StartStudioRunInput["agents"];
    state: StudioRunState;
    auto_approve?: boolean;
  },
  stepIndex: number,
  feedback?: string,
): Promise<OrchestratorOutcome> {
  const { bridge, steps, agents, state, auto_approve } = input;
  if (stepIndex < 0 || stepIndex >= steps.length) {
    return {
      kind: "completed",
      state: { ...state, status: "completed", pending_human: false },
      step_index: Math.max(0, steps.length - 1),
      summary: state.last_summary || "completed",
    };
  }

  const step = steps[stepIndex]!;
  const stage = stepStage(step, agents);
  let result: StageResult;
  try {
    result = await bridge.executeStage(state.bridge_run_id, stage, {
      feedback: feedback || "",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(state, stepIndex, msg);
  }

  if (result.status === "error") {
    return fail(
      stateFromStage(state, result),
      stepIndex,
      result.summary || `stage ${stage} failed`,
      result,
    );
  }

  const pausedOrRunning = afterStageSuccess({
    state,
    step_index: stepIndex,
    step,
    stage,
    result,
    auto_approve,
  });

  if (pausedOrRunning.kind !== "running") {
    return pausedOrRunning;
  }

  // Auto-approve (or no human gate): clear Bridge pending approval before next stage.
  if (auto_approve || !step.human_approval) {
    if (step.human_approval && result.pendingHumanApproval) {
      try {
        await bridge.decide(state.bridge_run_id, {
          decision: "approve",
          feedback: "自动确认",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/404|not found|no pending/i.test(msg)) {
          return fail(pausedOrRunning.state, stepIndex, `自动确认失败: ${msg}`, result);
        }
      }
    }
    return continueAfterStep({
      bridge,
      steps,
      agents,
      state: pausedOrRunning.state,
      step_index: stepIndex,
      auto_approve,
      last_result: result,
    });
  }

  return pausedOrRunning;
}

async function continueAfterStep(opts: {
  bridge: StartStudioRunInput["bridge"];
  steps: OrchestratorStep[];
  agents: StartStudioRunInput["agents"];
  state: StudioRunState;
  step_index: number;
  auto_approve?: boolean;
  last_result?: StageResult;
}): Promise<OrchestratorOutcome> {
  const nextIndex = opts.step_index + 1;
  if (nextIndex >= opts.steps.length) {
    return {
      kind: "completed",
      state: { ...opts.state, status: "completed", pending_human: false },
      step_index: opts.step_index,
      summary: opts.last_result?.summary || opts.state.last_summary || "completed",
      stage_result: opts.last_result,
    };
  }
  return runStepAtIndex(
    {
      bridge: opts.bridge,
      steps: opts.steps,
      agents: opts.agents,
      state: opts.state,
      auto_approve: opts.auto_approve,
    },
    nextIndex,
  );
}

/**
 * Create Bridge run (manager) then execute pipeline steps until a human gate
 * or completion. Does not persist — Studio host owns MySQL / WS.
 */
export async function startStudioRun(
  input: StartStudioRunInput,
): Promise<OrchestratorOutcome> {
  const created = await input.bridge.createRun({
    agents_md_path: input.agents_md_path || undefined,
    raw_requirement: input.raw_requirement,
    routing_mode: input.routing_mode || "explicit",
  });
  const bridgeRunId = String(created.run?.id || "").trim();
  if (!bridgeRunId) {
    return fail(
      {
        bridge_run_id: "",
        bridge_base_url: input.bridge_base_url,
        status: "failed",
        error: "Bridge createRun missing run.id",
      },
      0,
      "Bridge createRun missing run.id",
    );
  }

  const state: StudioRunState = {
    bridge_run_id: bridgeRunId,
    bridge_base_url: input.bridge_base_url,
    current_stage: "manager",
    last_summary:
      (created.manager && typeof created.manager.summary === "string"
        ? created.manager.summary
        : "") || "",
    pending_human: false,
    status: "running",
    error: null,
  };

  if (!input.steps.length) {
    return {
      kind: "completed",
      state: { ...state, status: "completed" },
      step_index: 0,
      summary: state.last_summary || "no pipeline steps",
    };
  }

  return runStepAtIndex(
    {
      bridge: input.bridge,
      steps: input.steps,
      agents: input.agents,
      state,
      auto_approve: input.auto_approve,
    },
    0,
  );
}

/**
 * Apply Studio human decision for the current step, then continue.
 */
export async function applyStudioDecision(
  input: ApplyDecisionInput,
): Promise<OrchestratorOutcome> {
  const {
    bridge,
    steps,
    agents,
    state,
    current_step_index,
    decision,
    feedback,
    auto_approve,
  } = input;
  const step = steps[current_step_index];
  if (!step) {
    return fail(state, current_step_index, "no current step for decision");
  }

  try {
    await bridge.decide(state.bridge_run_id, {
      decision,
      feedback: feedback || "",
    });
  } catch (err) {
    // Bridge may already have advanced without /decision (Dify-style). Continue.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/404|not found|no pending/i.test(msg)) {
      // Still try to continue on soft mismatch; hard errors fail.
      if (/unauthorized|auth|503|bridge_busy/i.test(msg)) {
        return fail(state, current_step_index, msg);
      }
    }
  }

  if (decision === "reject") {
    const onReject = step.on_reject || "end";
    if (onReject === "retry_step") {
      return runStepAtIndex(
        { bridge, steps, agents, state, auto_approve },
        current_step_index,
        feedback,
      );
    }
    if (onReject === "goto" && step.reject_goto) {
      const gotoIdx = steps.findIndex((s) => s.step_id === step.reject_goto);
      if (gotoIdx >= 0) {
        return runStepAtIndex(
          { bridge, steps, agents, state, auto_approve },
          gotoIdx,
          feedback,
        );
      }
    }
    return {
      kind: "rejected",
      state: {
        ...state,
        status: "rejected",
        pending_human: false,
        last_summary: feedback || "rejected",
      },
      step_index: current_step_index,
      summary: feedback || "rejected",
    };
  }

  // approve → next step
  return continueAfterStep({
    bridge,
    steps,
    agents,
    state: { ...state, pending_human: false, status: "running" },
    step_index: current_step_index,
    auto_approve,
  });
}
