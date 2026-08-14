import {
  entryStepIndex,
  resolveAdvance,
  resolveRejectRoute,
  workflowGraphFromSteps,
  type WorkflowGraph,
} from "./graph";
import { executeNonAgentStep } from "./step-executors";
import { bridgeStageForAgent } from "./stage-map";
import type {
  ApplyDecisionInput,
  ApplyStudioEventInput,
  OrchestratorOutcome,
  OrchestratorProgress,
  OrchestratorStep,
  ResumeStudioRunInput,
  StageResult,
  StartStudioRunInput,
  StudioRunState,
} from "./types";

function stepStage(
  step: OrchestratorStep,
  agents: StartStudioRunInput["agents"],
): string {
  const kind = step.kind || "agent";
  if (kind !== "agent") return kind;
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

function graphOf(
  steps: OrchestratorStep[],
  opts?: { entry?: string; edges?: StartStudioRunInput["edges"] },
): WorkflowGraph {
  return workflowGraphFromSteps(steps, {
    entry: opts?.entry,
    edges: opts?.edges,
  });
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

type RunCtx = {
  bridge: StartStudioRunInput["bridge"];
  steps: OrchestratorStep[];
  agents: StartStudioRunInput["agents"];
  state: StudioRunState;
  auto_approve?: boolean;
  onProgress?: StartStudioRunInput["onProgress"];
  graph: WorkflowGraph;
  raw_requirement?: string;
  work_order_id?: string;
  run_id?: string;
  title?: string;
};

async function runStepAtIndex(
  input: RunCtx,
  stepIndex: number,
  feedback?: string,
  transition?: OrchestratorProgress["transition"],
  fromStepIndex?: number,
): Promise<OrchestratorOutcome> {
  const { bridge, steps, agents, state, auto_approve, onProgress, graph } =
    input;
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

  const nonAgent = await executeNonAgentStep(step, {
    bridge_run_id: state.bridge_run_id,
    raw_requirement: input.raw_requirement || "",
    title: input.title,
    work_order_id: input.work_order_id,
    run_id: input.run_id,
    feedback,
  });

  if (nonAgent && "kind" in nonAgent && nonAgent.kind === "waiting_event") {
    const waitingState: StudioRunState = {
      ...state,
      status: "waiting",
      pending_human: false,
      current_stage: stage,
      last_summary: nonAgent.summary,
      error: null,
    };
    if (onProgress) {
      await onProgress({
        state: waitingState,
        step_index: stepIndex,
        stage,
        summary: nonAgent.summary,
        transition: transition || "advance",
        from_step_index: fromStepIndex,
      });
    }
    return {
      kind: "waiting_event",
      state: waitingState,
      step_index: stepIndex,
      stage,
      summary: nonAgent.summary,
      event: nonAgent.event,
    };
  }

  let result: StageResult;
  if (nonAgent && !("kind" in nonAgent)) {
    result = nonAgent;
  } else {
    try {
      result = await bridge.executeStage(state.bridge_run_id, stage, {
        feedback: feedback || "",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(state, stepIndex, msg);
    }
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

  if (onProgress) {
    await onProgress({
      state: pausedOrRunning.state,
      step_index: stepIndex,
      stage,
      summary: result.summary,
      stage_result: result,
      transition: transition || "advance",
      from_step_index: fromStepIndex,
    });
  }

  if (pausedOrRunning.kind !== "running") {
    return pausedOrRunning;
  }

  // Auto-approve (or no human gate): clear Bridge pending approval before next stage.
  if (auto_approve || !step.human_approval) {
    if (
      (step.kind || "agent") === "agent" &&
      step.human_approval &&
      result.pendingHumanApproval
    ) {
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
      ...input,
      state: pausedOrRunning.state,
      step_index: stepIndex,
      last_result: result,
    });
  }

  return pausedOrRunning;
}

async function continueAfterStep(opts: RunCtx & {
  step_index: number;
  last_result?: StageResult;
  feedback?: string;
}): Promise<OrchestratorOutcome> {
  const target = resolveAdvance(opts.steps, opts.graph, opts.step_index, {
    feedback: opts.feedback || "",
    summary: opts.last_result?.summary || opts.state.last_summary || "",
    artifacts: opts.last_result?.artifacts || [],
  });

  if (target.kind === "end") {
    return {
      kind: "completed",
      state: { ...opts.state, status: "completed", pending_human: false },
      step_index: opts.step_index,
      summary: opts.last_result?.summary || opts.state.last_summary || "completed",
      stage_result: opts.last_result,
    };
  }

  if (target.kind === "parallel") {
    return runParallelGroup({
      ...opts,
      branch_indices: target.branch_indices,
      join: target.join,
      then_index: target.then_index,
      from_step_index: opts.step_index,
    });
  }

  return runStepAtIndex(
    opts,
    target.step_index,
    undefined,
    "advance",
    opts.step_index,
  );
}

/**
 * Execute parallel branch stages concurrently on the same Bridge run, then join.
 */
async function runParallelGroup(
  opts: RunCtx & {
    branch_indices: number[];
    join: "all" | "any";
    then_index: number;
    from_step_index: number;
  },
): Promise<OrchestratorOutcome> {
  const {
    bridge,
    steps,
    agents,
    state,
    onProgress,
    branch_indices,
    join,
    then_index,
    from_step_index,
  } = opts;

  if (onProgress) {
    await onProgress({
      state: { ...state, status: "running", pending_human: false },
      step_index: branch_indices[0]!,
      stage: stepStage(steps[branch_indices[0]!]!, agents),
      summary: `并行执行 ${branch_indices.length} 个步骤…`,
      transition: "parallel",
      from_step_index,
      active_step_indices: branch_indices,
    });
  }

  const settled = await Promise.all(
    branch_indices.map(async (stepIndex) => {
      const step = steps[stepIndex]!;
      const stage = stepStage(step, agents);
      try {
        const nonAgent = await executeNonAgentStep(step, {
          bridge_run_id: state.bridge_run_id,
          raw_requirement: opts.raw_requirement || "",
          title: opts.title,
          work_order_id: opts.work_order_id,
          run_id: opts.run_id,
        });
        if (nonAgent && "kind" in nonAgent && nonAgent.kind === "waiting_event") {
          return {
            stepIndex,
            stage,
            result: null as StageResult | null,
            error: "并行分支不支持 wait_event",
          };
        }
        const result =
          nonAgent && !("kind" in nonAgent)
            ? nonAgent
            : await bridge.executeStage(state.bridge_run_id, stage, {
                feedback: "",
              });
        return { stepIndex, stage, result, error: null as string | null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          stepIndex,
          stage,
          result: null as StageResult | null,
          error: msg,
        };
      }
    }),
  );

  let lastOk: StageResult | undefined;
  let lastState = state;
  const failures: Array<{ stepIndex: number; error: string }> = [];
  const successes: number[] = [];

  for (const item of settled) {
    if (item.error || !item.result || item.result.status === "error") {
      const error =
        item.error ||
        item.result?.summary ||
        `stage ${item.stage} failed`;
      failures.push({ stepIndex: item.stepIndex, error });
      if (onProgress) {
        await onProgress({
          state: {
            ...lastState,
            status: "running",
            error,
          },
          step_index: item.stepIndex,
          stage: item.stage,
          summary: error,
          stage_result: item.result || undefined,
          transition: "parallel",
          from_step_index,
          active_step_indices: branch_indices,
        });
      }
      continue;
    }

    successes.push(item.stepIndex);
    lastOk = item.result;
    lastState = stateFromStage(lastState, item.result, {
      status: "running",
      pending_human: false,
    });

    // Clear Bridge pending if a branch somehow requested human (should be disabled).
    if (item.result.pendingHumanApproval) {
      try {
        await bridge.decide(state.bridge_run_id, {
          decision: "approve",
          feedback: "并行分支自动确认",
        });
      } catch {
        /* ignore soft decide errors */
      }
    }

    if (onProgress) {
      await onProgress({
        state: lastState,
        step_index: item.stepIndex,
        stage: item.stage,
        summary: item.result.summary,
        stage_result: item.result,
        transition: "parallel",
        from_step_index,
        active_step_indices: branch_indices,
      });
    }
  }

  if (join === "all" && failures.length) {
    const first = failures[0]!;
    return fail(
      { ...lastState, status: "failed", error: first.error },
      first.stepIndex,
      first.error,
    );
  }
  if (join === "any" && successes.length === 0) {
    const first = failures[0]!;
    return fail(
      { ...lastState, status: "failed", error: first.error },
      first.stepIndex,
      first.error || "并行分支全部失败",
    );
  }

  if (then_index < 0) {
    return {
      kind: "completed",
      state: { ...lastState, status: "completed", pending_human: false },
      step_index: successes[0] ?? branch_indices[0]!,
      summary: lastOk?.summary || lastState.last_summary || "completed",
      stage_result: lastOk,
    };
  }

  return runStepAtIndex(
    { ...opts, state: lastState },
    then_index,
    undefined,
    "advance",
    from_step_index,
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

  const graph = graphOf(input.steps, {
    entry: input.entry,
    edges: input.edges,
  });

  if (input.onProgress) {
    await input.onProgress({
      state,
      step_index: entryStepIndex(input.steps, graph),
      stage: "manager",
      summary: state.last_summary || "manager ok",
      transition: "start",
    });
  }

  if (!input.steps.length) {
    return {
      kind: "completed",
      state: { ...state, status: "completed" },
      step_index: 0,
      summary: state.last_summary || "no pipeline steps",
    };
  }

  const startIdx = entryStepIndex(input.steps, graph);
  return runStepAtIndex(
    {
      bridge: input.bridge,
      steps: input.steps,
      agents: input.agents,
      state,
      auto_approve: input.auto_approve,
      onProgress: input.onProgress,
      graph,
      raw_requirement: input.raw_requirement,
      work_order_id: input.work_order_id,
      run_id: input.run_id,
      title: input.title,
    },
    startIdx,
    undefined,
    "start",
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

  const graph = graphOf(steps, { entry: input.entry, edges: input.edges });
  const ctx: RunCtx = {
    bridge,
    steps,
    agents,
    state,
    auto_approve,
    onProgress: input.onProgress,
    graph,
    raw_requirement: input.raw_requirement,
    work_order_id: input.work_order_id,
    run_id: input.run_id,
    title: input.title,
  };

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
    const route = resolveRejectRoute(steps, graph, current_step_index);
    if (route.kind === "retry") {
      return runStepAtIndex(
        ctx,
        current_step_index,
        feedback,
        "retry",
        current_step_index,
      );
    }
    if (route.kind === "goto") {
      return runStepAtIndex(
        { ...ctx, state: { ...state, pending_human: false, status: "running" } },
        route.step_index,
        feedback,
        "goto_reject",
        current_step_index,
      );
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

  // approve → follow cond / next edge
  return continueAfterStep({
    ...ctx,
    state: { ...state, pending_human: false, status: "running" },
    step_index: current_step_index,
    feedback: feedback || "",
    last_result: {
      runId: state.bridge_run_id,
      stage: state.current_stage || step.agent,
      status: "ok",
      summary: state.last_summary || "",
      artifacts: [],
      pendingHumanApproval: false,
    },
  });
}

/**
 * Resume from a failed (or interrupted) pipeline step on an existing Bridge run.
 * Does not call createRun / manager — reuses `state.bridge_run_id`.
 */
export async function resumeStudioRun(
  input: ResumeStudioRunInput,
): Promise<OrchestratorOutcome> {
  const bridgeRunId = (input.state.bridge_run_id || "").trim();
  if (!bridgeRunId) {
    return fail(
      { ...input.state, status: "failed", error: "missing bridge_run_id" },
      input.current_step_index,
      "无法续跑：缺少 Bridge run id，请改用「重新执行」",
    );
  }
  if (!input.steps.length) {
    return fail(
      input.state,
      0,
      "无法续跑：流水线无步骤",
    );
  }
  const idx = Math.min(
    Math.max(0, input.current_step_index),
    input.steps.length - 1,
  );
  const state: StudioRunState = {
    ...input.state,
    bridge_run_id: bridgeRunId,
    status: "running",
    pending_human: false,
    error: null,
  };
  const graph = graphOf(input.steps, {
    entry: input.entry,
    edges: input.edges,
  });
  if (input.onProgress) {
    await input.onProgress({
      state,
      step_index: idx,
      stage: stepStage(input.steps[idx]!, input.agents),
      summary: input.feedback?.trim() || "从失败阶段续跑…",
      transition: "resume",
    });
  }
  return runStepAtIndex(
    {
      bridge: input.bridge,
      steps: input.steps,
      agents: input.agents,
      state,
      auto_approve: input.auto_approve,
      onProgress: input.onProgress,
      graph,
      raw_requirement: input.raw_requirement,
      work_order_id: input.work_order_id,
      run_id: input.run_id,
      title: input.title,
    },
    idx,
    input.feedback,
    "resume",
  );
}

/**
 * Complete a wait_event step when an external Forge/manual event arrives, then continue.
 */
export async function applyStudioEvent(
  input: ApplyStudioEventInput,
): Promise<OrchestratorOutcome> {
  const step = input.steps[input.current_step_index];
  if (!step) {
    return fail(input.state, input.current_step_index, "no current step for event");
  }
  if ((step.kind || "agent") !== "wait_event") {
    return fail(
      input.state,
      input.current_step_index,
      `当前步骤不是 wait_event（kind=${step.kind || "agent"}）`,
    );
  }
  const expected = step.wait_event?.event || "manual";
  if (expected !== input.event && expected !== "manual") {
    return fail(
      input.state,
      input.current_step_index,
      `事件不匹配：需要 ${expected}，收到 ${input.event}`,
    );
  }
  if (
    expected === "issue_labeled" &&
    (step.wait_event?.labels || []).length
  ) {
    const want = new Set(
      (step.wait_event?.labels || []).map((l) => l.toLowerCase()),
    );
    const got = (input.labels || []).map((l) => l.toLowerCase());
    if (!got.some((l) => want.has(l))) {
      return fail(
        input.state,
        input.current_step_index,
        `标签不匹配：需要 ${[...want].join(",")}，收到 ${got.join(",") || "(无)"}`,
      );
    }
  }

  const graph = graphOf(input.steps, {
    entry: input.entry,
    edges: input.edges,
  });
  const summary =
    input.feedback?.trim() ||
    `事件已到达：${input.event}`;
  return continueAfterStep({
    bridge: input.bridge,
    steps: input.steps,
    agents: input.agents,
    state: {
      ...input.state,
      status: "running",
      pending_human: false,
      last_summary: summary,
      error: null,
    },
    auto_approve: input.auto_approve,
    onProgress: input.onProgress,
    graph,
    raw_requirement: input.raw_requirement,
    work_order_id: input.work_order_id,
    run_id: input.run_id,
    title: input.title,
    step_index: input.current_step_index,
    feedback: input.feedback || "",
    last_result: {
      runId: input.state.bridge_run_id,
      stage: "wait_event",
      status: "ok",
      summary,
      artifacts: [],
      pendingHumanApproval: false,
    },
  });
}
