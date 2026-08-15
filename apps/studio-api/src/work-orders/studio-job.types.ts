/** Serializable Studio orchestrator job kinds (worker / API queue). */

export type StudioJobKind =
  | "prepare_start"
  | "start"
  | "decide"
  | "resume"
  | "event";

export type StudioJobStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export type StudioJobPrepareStartPayload = {
  agents_md_path?: string;
  bridge_base_url?: string;
  reuse_previous_routing?: boolean;
};

export type StudioJobStartPayload = {
  bridge_base_url: string;
  agents_md_path: string;
  routing_mode: "auto" | "explicit";
  auto_approve: boolean;
};

export type StudioJobDecidePayload = {
  decision: "approve" | "reject";
  feedback: string;
  bridge_base_url: string;
};

export type StudioJobResumePayload = {
  feedback: string;
  bridge_base_url: string;
};

export type StudioJobEventPayload = {
  event: "mr_merged" | "issue_labeled" | "manual";
  labels?: string[];
  feedback?: string;
  bridge_base_url: string;
};

export type StudioJobPayload =
  | StudioJobPrepareStartPayload
  | StudioJobStartPayload
  | StudioJobDecidePayload
  | StudioJobResumePayload
  | StudioJobEventPayload;

export function orchestratorMode(): "inline" | "worker" {
  const v = (process.env.STUDIO_ORCHESTRATOR_MODE || "inline").trim().toLowerCase();
  return v === "worker" ? "worker" : "inline";
}

export function processRole(): "api" | "worker" {
  const v = (process.env.STUDIO_PROCESS_ROLE || "api").trim().toLowerCase();
  return v === "worker" ? "worker" : "api";
}

/** Whether this process should claim and run studio_jobs. */
export function shouldRunStudioJobs(): boolean {
  const mode = orchestratorMode();
  const role = processRole();
  if (mode === "worker") return role === "worker";
  return role === "api";
}
