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
  human_approval: boolean;
  on_reject?: "end" | "retry_step" | "goto";
  reject_goto?: string;
};

export type OrchestratorAgentLookup = {
  get(agentId: string): StageMapAgentLike | undefined;
};

export type StageMapAgentLike = {
  role?: string | null;
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
