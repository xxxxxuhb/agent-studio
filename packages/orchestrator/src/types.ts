import type {
  PipelineCiStep,
  PipelineDelayStep,
  PipelineEdge,
  PipelineHttpStep,
  PipelineStepBranch,
  PipelineStepKind,
  PipelineStepParallel,
  PipelineWaitEventStep,
} from "@agent-studio/agent-schema";

export type BridgeStage =
  | "manager"
  | "requirement"
  | "plan"
  | "dev"
  | "review"
  | "test"
  | "release_test"
  | string;

export type StageResult = {
  runId: string;
  stage: BridgeStage;
  status: "ok" | "error";
  summary: string;
  artifacts: string[];
  pendingHumanApproval: boolean;
  raw?: string;
  driver?: string;
  dryRun?: boolean;
  /** Optional token/cost telemetry when the driver reports it. */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost_usd?: number;
  };
};

export type CreateRunResult = {
  run: { id: string; status?: string; [k: string]: unknown };
  manager?: { summary?: string; [k: string]: unknown };
  routing?: unknown;
};

export type BridgeClient = {
  createRun(body: {
    agents_md_path?: string;
    raw_requirement: string;
    routing_mode?: "auto" | "explicit";
  }): Promise<CreateRunResult>;
  executeStage(
    runId: string,
    stage: string,
    body?: { feedback?: string },
  ): Promise<StageResult>;
  decide(
    runId: string,
    body: { decision: "approve" | "reject"; feedback?: string },
  ): Promise<unknown>;
};

export type OrchestratorStep = {
  step_id: string;
  agent: string;
  label?: string;
  kind?: PipelineStepKind;
  human_approval: boolean;
  on_reject?: "end" | "retry_step" | "goto";
  reject_goto?: string;
  /** Approve-side branches (mirrored into graph edges when synthesizing). */
  branches?: PipelineStepBranch[];
  /** Fan-out after this step (review ∥ test → join). */
  parallel?: PipelineStepParallel | null;
  http?: PipelineHttpStep | null;
  wait_event?: PipelineWaitEventStep | null;
  ci?: PipelineCiStep | null;
  delay?: PipelineDelayStep | null;
};

export type OrchestratorAgentLookup = {
  get(agentId: string): StageMapAgentLike | undefined;
};

export type StageMapAgentLike = {
  role?: string | null;
  bridge?: { stage_id?: string | null } | null;
  dify?: { agent_id?: string | null } | null;
};

export type StudioRunState = {
  bridge_run_id: string;
  bridge_base_url: string;
  current_stage?: string;
  last_summary?: string;
  pending_human?: boolean;
  dry_run?: boolean;
  status?: string;
  error?: string | null;
};

export type OrchestratorProgress = {
  state: StudioRunState;
  step_index: number;
  stage: string;
  summary: string;
  stage_result?: StageResult;
  /**
   * How we arrived at this step (for Studio status bookkeeping).
   * - advance: happy-path next edge
   * - retry: same step after reject
   * - goto_reject: reject edge to another step
   * - start / resume: initial entry into a step
   */
  transition?:
    | "start"
    | "advance"
    | "retry"
    | "goto_reject"
    | "resume"
    | "parallel";
  from_step_index?: number;
  /** Parallel fan-out: all branch indices currently executing. */
  active_step_indices?: number[];
};

export type StartStudioRunInput = {
  bridge: BridgeClient;
  steps: OrchestratorStep[];
  agents: OrchestratorAgentLookup;
  agents_md_path: string;
  raw_requirement: string;
  routing_mode?: "auto" | "explicit";
  bridge_base_url: string;
  /** When true, do not pause for human_approval (auto-continue). */
  auto_approve?: boolean;
  /** Optional graph; empty edges → synthesize linear + reject from steps. */
  entry?: string;
  edges?: PipelineEdge[];
  /** Template vars for http/ci steps. */
  work_order_id?: string;
  run_id?: string;
  title?: string;
  /** Fired after createRun and after each successful stage (for live UI). */
  onProgress?: (progress: OrchestratorProgress) => Promise<void> | void;
};

export type ApplyDecisionInput = {
  bridge: BridgeClient;
  steps: OrchestratorStep[];
  agents: OrchestratorAgentLookup;
  state: StudioRunState;
  current_step_index: number;
  decision: "approve" | "reject";
  feedback?: string;
  auto_approve?: boolean;
  entry?: string;
  edges?: PipelineEdge[];
  work_order_id?: string;
  run_id?: string;
  title?: string;
  raw_requirement?: string;
  onProgress?: (progress: OrchestratorProgress) => Promise<void> | void;
};

/** Resume a failed stage on an existing Bridge run (no createRun). */
export type ResumeStudioRunInput = {
  bridge: BridgeClient;
  steps: OrchestratorStep[];
  agents: OrchestratorAgentLookup;
  state: StudioRunState;
  current_step_index: number;
  feedback?: string;
  auto_approve?: boolean;
  entry?: string;
  edges?: PipelineEdge[];
  work_order_id?: string;
  run_id?: string;
  title?: string;
  raw_requirement?: string;
  onProgress?: (progress: OrchestratorProgress) => Promise<void> | void;
};

/** Resume a wait_event step when an external event arrives. */
export type ApplyStudioEventInput = {
  bridge: BridgeClient;
  steps: OrchestratorStep[];
  agents: OrchestratorAgentLookup;
  state: StudioRunState;
  current_step_index: number;
  event: "mr_merged" | "issue_labeled" | "manual";
  labels?: string[];
  feedback?: string;
  auto_approve?: boolean;
  entry?: string;
  edges?: PipelineEdge[];
  work_order_id?: string;
  run_id?: string;
  title?: string;
  raw_requirement?: string;
  onProgress?: (progress: OrchestratorProgress) => Promise<void> | void;
};

export type OrchestratorOutcome =
  | {
      kind: "pending_approval";
      state: StudioRunState;
      step_index: number;
      stage: string;
      summary: string;
      stage_result: StageResult;
    }
  | {
      kind: "waiting_event";
      state: StudioRunState;
      step_index: number;
      stage: string;
      summary: string;
      event: string;
    }
  | {
      kind: "running";
      state: StudioRunState;
      step_index: number;
      stage: string;
      summary: string;
      stage_result: StageResult;
    }
  | {
      kind: "completed";
      state: StudioRunState;
      step_index: number;
      summary: string;
      stage_result?: StageResult;
    }
  | {
      kind: "rejected";
      state: StudioRunState;
      step_index: number;
      summary: string;
    }
  | {
      kind: "failed";
      state: StudioRunState;
      step_index: number;
      summary: string;
      error: string;
      stage_result?: StageResult;
    };
