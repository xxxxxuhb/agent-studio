import { z } from "zod";
import {
  DigitalHumanDifyBindingSchema,
  PipelineDifyBindingPublicSchema,
  PipelineDifyBindingSchema,
} from "./dify";

export const RoleSchema = z.enum([
  "intake",
  "clarify",
  "spec",
  "plan",
  "implement",
  "review",
  "verify",
  "ops",
  "orchestrate",
]);
export type Role = z.infer<typeof RoleSchema>;

export const ArtifactRefSchema = z.object({
  key: z.string().min(1),
  path: z.string().min(1),
  required: z.boolean().optional().default(true),
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export const AgentPermissionsSchema = z.object({
  may_modify_code: z.boolean(),
  may_run_commands: z.boolean(),
  /** After a passing review, commit (and optionally push) working tree changes. */
  may_commit: z.boolean().optional().default(false),
  may_deploy: z.enum(["none", "staging", "production"]),
  forbidden_paths_extra: z.array(z.string()).optional().default([]),
});
export type AgentPermissions = z.infer<typeof AgentPermissionsSchema>;

export const DigitalHumanSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, "id must be snake_case starting with a letter"),
  /** Owning team; empty = legacy / unassigned (bootstrap stamps default). */
  team_id: z.string().optional().default(""),
  name: z.string().min(1),
  role: RoleSchema,
  description: z.string().optional().default(""),
  responsibilities: z.array(z.string()).min(1),
  permissions: AgentPermissionsSchema,
  inputs: z.array(ArtifactRefSchema).default([]),
  outputs: z.array(ArtifactRefSchema).min(1),
  commands: z
    .array(
      z.enum([
        "install",
        "test",
        "lint",
        "commit",
        "push",
        "deploy_staging",
        "smoke_staging",
      ]),
    )
    .default([]),
  human_gate_default: z.boolean().default(true),
  prompt_hints: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  avatar_label: z.string().optional().default(""),
  tags: z.array(z.string()).default([]),
  /**
   * Legacy Bridge stage override (`dify.agent_id`). Prefer role / id mapping
   * in `@agent-studio/orchestrator`; kept for existing MySQL rows.
   */
  dify: DigitalHumanDifyBindingSchema.optional().default({}),
  updated_at: z.string().optional(),
  created_at: z.string().optional(),
});
export type DigitalHuman = z.infer<typeof DigitalHumanSchema>;

export const DigitalHumanCreateSchema = DigitalHumanSchema.omit({
  created_at: true,
  updated_at: true,
});
export type DigitalHumanCreate = z.infer<typeof DigitalHumanCreateSchema>;

export const DigitalHumanUpdateSchema = DigitalHumanCreateSchema.partial().omit({
  id: true,
});
export type DigitalHumanUpdate = z.infer<typeof DigitalHumanUpdateSchema>;

export const ROLES = RoleSchema.options;

export const PipelineStepSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, "step id must be snake_case"),
  agent: z.string().min(1),
  label: z.string().optional().default(""),
  human_approval: z.boolean().default(true),
  on_reject: z.enum(["end", "retry_step", "goto"]).default("end"),
  reject_goto: z.string().optional(),
  inputs_from: z.array(z.string()).default([]),
});
export type PipelineStep = z.infer<typeof PipelineStepSchema>;

export const PipelineSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, "id must be kebab/snake case"),
  /** Owning team; empty = legacy / unassigned (bootstrap stamps default). */
  team_id: z.string().optional().default(""),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  source: z
    .object({
      kind: z.enum(["handwritten", "template", "nl"]).default("handwritten"),
      nl_prompt: z.string().optional(),
      template_id: z.string().optional(),
    })
    .default({ kind: "handwritten" }),
  defaults: z
    .object({
      human_approval: z.boolean().default(true),
      on_reject: z.enum(["end", "retry_step", "goto"]).default("end"),
    })
    .default({ human_approval: true, on_reject: "end" }),
  steps: z.array(PipelineStepSchema).min(1),
  /** Legacy Dify Workflow binding (ignored by Studio orchestrator). */
  dify: PipelineDifyBindingSchema.optional().default({}),
  updated_at: z.string().optional(),
  created_at: z.string().optional(),
});
export type Pipeline = z.infer<typeof PipelineSchema>;

export const PipelinePublicSchema = PipelineSchema.omit({ dify: true }).extend({
  dify: PipelineDifyBindingPublicSchema.default({}),
});
export type PipelinePublic = z.infer<typeof PipelinePublicSchema>;

export const PipelineCreateSchema = PipelineSchema.omit({
  created_at: true,
  updated_at: true,
});
export type PipelineCreate = z.infer<typeof PipelineCreateSchema>;

export const PipelineUpdateSchema = PipelineCreateSchema.partial().omit({
  id: true,
});
export type PipelineUpdate = z.infer<typeof PipelineUpdateSchema>;

export const PipelineComposeSchema = z.object({
  prompt: z.string().min(1),
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/)
    .optional(),
  name: z.string().optional(),
  save: z.boolean().optional().default(false),
  /** Required when save=true (team-scoped write). */
  team_id: z.string().optional().default(""),
});
export type PipelineCompose = z.infer<typeof PipelineComposeSchema>;

export const WorkOrderStatusSchema = z.enum([
  "draft",
  "queued",
  "running",
  "pending_approval",
  "completed",
  "rejected",
  "failed",
  "cancelled",
]);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;

export const RunStepStatusSchema = z.enum([
  "pending",
  "running",
  "pending_approval",
  "approved",
  "rejected",
  "failed",
  "skipped",
]);
export type RunStepStatus = z.infer<typeof RunStepStatusSchema>;

export const WorkOrderRunStepSchema = z.object({
  step_id: z.string(),
  agent: z.string(),
  label: z.string().default(""),
  human_approval: z.boolean().default(true),
  on_reject: z.enum(["end", "retry_step", "goto"]).default("end"),
  reject_goto: z.string().optional(),
  status: RunStepStatusSchema.default("pending"),
  /** One-line / short status blurb */
  summary: z.string().default(""),
  /** Full agent artifact (markdown) shown on work-order detail */
  output: z.string().default(""),
  output_title: z.string().optional().default(""),
  feedback: z.string().default(""),
  started_at: z.string().optional(),
  finished_at: z.string().optional(),
});
export type WorkOrderRunStep = z.infer<typeof WorkOrderRunStepSchema>;

export const WorkOrderGitSchema = z.object({
  status: z
    .enum(["clean", "dirty", "committed", "pushed", "pr_open"])
    .default("clean"),
  branch: z.string().optional().default(""),
  base_sha: z.string().optional().default(""),
  head_sha: z.string().optional().default(""),
  commit_sha: z.string().optional().default(""),
  commit_message: z.string().optional().default(""),
  pr_url: z.string().optional().default(""),
  committed_at: z.string().optional(),
  committed_by_step: z.string().optional().default(""),
  note: z.string().optional().default(""),
});
export type WorkOrderGit = z.infer<typeof WorkOrderGitSchema>;

/** Append-only timeline for a work-order run (control-plane audit). */
export const WorkOrderRunEventSchema = z.object({
  // Older rows / recovery scripts may omit id — synthesize so list/get don't 500.
  id: z.preprocess(
    (v) =>
      typeof v === "string" && v.trim()
        ? v.trim()
        : `ev-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    z.string().min(1),
  ),
  at: z.string(),
  type: z.enum([
    "run_started",
    "dify_started",
    "dify_status",
    "bridge_stage",
    "human_input_required",
    "human_decision",
    "step_mirrored",
    "run_finished",
    "sync_error",
    "info",
    "warning",
  ]),
  level: z.enum(["info", "warn", "error"]).default("info"),
  message: z.string(),
  step_id: z.string().optional(),
  agent: z.string().optional(),
  bridge_stage: z.string().optional(),
  bridge_run_id: z.string().optional(),
  dry_run: z.boolean().optional(),
  dify_status: z.string().optional(),
  action: z.string().optional(),
  detail: z.record(z.unknown()).optional(),
});
export type WorkOrderRunEvent = z.infer<typeof WorkOrderRunEventSchema>;

/** One repo target in a multi-repo work-order run (Manager-selected). */
export const WorkOrderRepoTargetSchema = z.object({
  repo_id: z.string(),
  name: z.string().optional().default(""),
  role: z.string().optional().default(""),
  agents_md_path: z.string(),
  local_path: z.string().optional().default(""),
  status: z
    .enum(["pending", "running", "completed", "failed", "skipped"])
    .default("pending"),
  started_at: z.string().optional(),
  finished_at: z.string().optional(),
  dify_workflow_run_id: z.string().optional().default(""),
  bridge_run_id: z.string().optional().default(""),
  note: z.string().optional().default(""),
});
export type WorkOrderRepoTarget = z.infer<typeof WorkOrderRepoTargetSchema>;

export const WorkOrderRunSchema = z.object({
  run_id: z.string(),
  pipeline_id: z.string(),
  pipeline_name: z.string(),
  executor: z.preprocess(
    (v) => {
      if (v === "local" || v === "dify" || v == null || v === "") return "studio";
      return v;
    },
    z.literal("studio"),
  ).default("studio"),
  /**
   * When true, Studio auto-submits approve at human gates.
   * Pipeline `human_approval` steps stay defined — this only replaces manual click.
   */
  auto_approve: z.boolean().optional().default(false),
  current_step_index: z.number().int().nonnegative().default(0),
  steps: z.array(WorkOrderRunStepSchema).default([]),
  started_at: z.string(),
  finished_at: z.string().optional(),
  /** Repo commit state produced by agents (e.g. code_review may_commit). */
  git: WorkOrderGitSchema.optional(),
  /** Structured run log (newest last). */
  events: z.array(WorkOrderRunEventSchema).default([]),
  /**
   * Repos selected by Manager for this run (project may have many).
   * Bridge must use these paths — not auto-route.
   */
  selected_repo_ids: z.array(z.string()).optional().default([]),
  selected_agents_md_path: z.string().optional().default(""),
  manager_routing_reason: z.string().optional().default(""),
  /** Ordered queue of repos to modify; Studio runs them sequentially. */
  repo_targets: z.array(WorkOrderRepoTargetSchema).optional().default([]),
  /** Index into repo_targets currently being modified. */
  current_repo_index: z.number().int().nonnegative().optional().default(0),
  /** Studio self-managed orchestrator state (executor=studio). */
  studio: z
    .object({
      bridge_run_id: z.string().optional().default(""),
      bridge_base_url: z.string().optional().default(""),
      current_stage: z.string().optional().default(""),
      last_summary: z.string().optional().default(""),
      pending_human: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
      status: z.string().optional().default(""),
      error: z.string().nullable().optional(),
      last_synced_at: z.string().optional(),
    })
    .optional(),
  dify: z
    .object({
      workflow_run_id: z.string().optional(),
      task_id: z.string().optional(),
      workflow_id: z.string().optional(),
      status: z.string().optional(),
      error: z.string().nullable().optional(),
      outputs: z.record(z.unknown()).optional(),
      inputs: z.record(z.unknown()).optional(),
      total_steps: z.number().optional(),
      elapsed_time: z.number().nullable().optional(),
      last_synced_at: z.string().optional(),
      raw_summary: z.string().optional(),
      /** End-user id passed to Dify (must match for form submit / events) */
      user: z.string().optional(),
      /** From SSE human_input_required — required for Studio confirm */
      form_token: z.string().nullable().optional(),
      form_content: z.string().optional(),
      form_node_title: z.string().optional(),
      form_expiration_time: z.number().nullable().optional(),
      form_actions: z
        .array(
          z.object({
            id: z.string(),
            title: z.string().optional(),
            button_style: z.string().optional(),
          }),
        )
        .optional(),
      form_inputs: z
        .array(
          z.object({
            type: z.string().optional(),
            output_variable_name: z.string(),
          }),
        )
        .optional(),
      /** Which credentials were used for this run */
      binding_source: z.enum(["pipeline", "team", "global"]).optional(),
      api_base: z.string().optional(),
      api_key_set: z.boolean().optional(),
      app_id: z.string().optional(),
      /** Last known Bridge run id (from HTTP stage response). */
      bridge_run_id: z.string().optional(),
      /** True when Bridge reports dry-run / missing CURSOR_API_KEY. */
      bridge_dry_run: z.boolean().optional(),
    })
    .optional(),
  /**
   * When status=queued, holds the start payload until a team Bridge becomes idle.
   * Cleared once the run is admitted.
   */
  pending_start: z
    .object({
      pipeline_id: z.string().min(1),
      auto_approve: z.boolean().optional().default(false),
      agents_md_path: z.string().optional(),
      bridge_base_url: z.string().optional(),
      reuse_previous_routing: z.boolean().optional().default(false),
      executor: z.preprocess(
        (v) => {
          if (v === "local" || v === "dify" || v == null || v === "") {
            return "studio";
          }
          return v;
        },
        z.literal("studio"),
      ).optional().default("studio"),
      enqueued_at: z.string(),
      note: z.string().optional().default(""),
    })
    .optional(),
});
export type WorkOrderRun = z.infer<typeof WorkOrderRunSchema>;

export const WorkOrderSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "id must be lowercase alphanumeric"),
  /** Owning team (required for ACL; derived from project when bound). */
  team_id: z.string().optional().default(""),
  title: z.string().min(1),
  requirement: z.string().min(1),
  status: WorkOrderStatusSchema.default("draft"),
  pipeline_id: z.string().optional(),
  /** Bound Studio project (multi-repo). */
  project_id: z.string().optional().default(""),
  /** Work item kind: feature request / bug / optimization / … */
  category: z
    .enum(["requirement", "bug", "enhancement", "chore", "other"])
    .default("requirement"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  tags: z.array(z.string()).default([]),
  clarifications: z
    .array(
      z.object({
        at: z.string(),
        note: z.string(),
      }),
    )
    .default([]),
  run: WorkOrderRunSchema.nullable().optional().default(null),
  updated_at: z.string().optional(),
  created_at: z.string().optional(),
});
export type WorkOrder = z.infer<typeof WorkOrderSchema>;
export type WorkOrderCategory = WorkOrder["category"];

export const WorkOrderCreateSchema = WorkOrderSchema.omit({
  created_at: true,
  updated_at: true,
  run: true,
  status: true,
}).extend({
  status: WorkOrderStatusSchema.optional().default("draft"),
  pipeline_id: z.string().optional(),
  project_id: z.string().optional().default(""),
});
export type WorkOrderCreate = z.infer<typeof WorkOrderCreateSchema>;

export const WorkOrderUpdateSchema = WorkOrderCreateSchema.partial().omit({
  id: true,
});
export type WorkOrderUpdate = z.infer<typeof WorkOrderUpdateSchema>;

export const WorkOrderStartSchema = z.object({
  pipeline_id: z.string().min(1),
  /** Always Studio orchestrator; legacy "dify"/"local" coerce to studio. */
  executor: z.preprocess(
    (v) => {
      if (v === "local" || v === "dify" || v == null || v === "") return "studio";
      return v;
    },
    z.literal("studio"),
  ).optional().default("studio"),
  /** Auto-approve human gates for this run (does not change pipeline definition). */
  auto_approve: z.boolean().optional().default(false),
  agents_md_path: z.string().optional(),
  bridge_base_url: z.string().optional(),
  /**
   * Reuse last run's manager repo plan (skip Bridge /routing/select).
   * Used by restart; first-time start should leave this false.
   */
  reuse_previous_routing: z.boolean().optional().default(false),
});
export type WorkOrderStart = z.infer<typeof WorkOrderStartSchema>;

/** Re-run: end active run if needed, then start again (defaults from last run). */
export const WorkOrderRestartSchema = z.object({
  pipeline_id: z.string().optional(),
  executor: z.preprocess(
    (v) => {
      if (v === "local" || v === "dify" || v == null || v === "") return "studio";
      return v;
    },
    z.literal("studio"),
  ).optional(),
  auto_approve: z.boolean().optional(),
  agents_md_path: z.string().optional(),
  bridge_base_url: z.string().optional(),
  feedback: z.string().optional(),
  /** When true, call Manager again to pick repos. Default: reuse last plan. */
  reselect_repos: z.boolean().optional().default(false),
});
export type WorkOrderRestart = z.infer<typeof WorkOrderRestartSchema>;

export const WorkOrderDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]).optional(),
  /** Optional action id (legacy Human Input); overrides decision mapping when set */
  action: z.string().optional(),
  feedback: z.string().optional().default(""),
  inputs: z.record(z.unknown()).optional(),
}).refine((v) => Boolean(v.decision || v.action), {
  message: "decision or action is required",
});
export type WorkOrderDecision = z.infer<typeof WorkOrderDecisionSchema>;

export const WorkOrderClarifySchema = z.object({
  note: z.string().min(1),
});
export type WorkOrderClarify = z.infer<typeof WorkOrderClarifySchema>;

export const WorkOrderReworkSchema = z.object({
  step_id: z.string().min(1),
  feedback: z.string().optional().default(""),
});
export type WorkOrderRework = z.infer<typeof WorkOrderReworkSchema>;

export const AgentChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "agent", "system"]),
  content: z.string(),
  created_at: z.string(),
  agent_id: z.string().optional(),
  agent_name: z.string().optional(),
  stage: z.string().optional(),
  error: z.string().optional(),
});
export type AgentChatMessage = z.infer<typeof AgentChatMessageSchema>;

export const AgentChatThreadSchema = z.object({
  work_order_id: z.string(),
  messages: z.array(AgentChatMessageSchema).default([]),
  updated_at: z.string().optional(),
});
export type AgentChatThread = z.infer<typeof AgentChatThreadSchema>;

export const AgentChatPostSchema = z.object({
  message: z.string().min(1),
});
export type AgentChatPost = z.infer<typeof AgentChatPostSchema>;

/** @deprecated Use AgentChat* — leftover ManagerChat aliases. */
export const ManagerChatMessageSchema = AgentChatMessageSchema;
export type ManagerChatMessage = AgentChatMessage;
export const ManagerChatThreadSchema = AgentChatThreadSchema;
export type ManagerChatThread = AgentChatThread;
export const ManagerChatPostSchema = AgentChatPostSchema;
export type ManagerChatPost = AgentChatPost;

export {
  parseAgentMentions,
  type MentionAgent,
  type ParsedMention,
  type ParseAgentMentionsResult,
} from "./mentions";

export {
  PipelineDifyBindingSchema,
  PipelineDifyBindingPublicSchema,
  DigitalHumanDifyBindingSchema,
  type PipelineDifyBinding,
  type PipelineDifyBindingPublic,
  type DigitalHumanDifyBinding,
} from "./dify";

export {
  ProjectSchema,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ProjectRepoSchema,
  ProjectRepoCreateSchema,
  ProjectRepoRoleSchema,
  ProjectRepoCloneStatusSchema,
  type Project,
  type ProjectCreate,
  type ProjectUpdate,
  type ProjectRepo,
  type ProjectRepoCreate,
  type ProjectRepoRole,
  type ProjectRepoCloneStatus,
} from "./project";

export {
  AuthUserPublicSchema,
  AuthLoginSchema,
  AuthRegisterSchema,
  AuthLoginResponseSchema,
  type AuthUserPublic,
  type AuthLogin,
  type AuthRegister,
  type AuthLoginResponse,
} from "./auth";

export {
  TeamMemberRoleSchema,
  TeamSchema,
  TeamCreateSchema,
  TeamMemberSchema,
  TeamMemberAddSchema,
  TeamMemberUpdateSchema,
  TeamDetailSchema,
  TeamListItemSchema,
  type TeamMemberRole,
  type Team,
  type TeamCreate,
  type TeamMember,
  type TeamMemberAdd,
  type TeamMemberUpdate,
  type TeamDetail,
  type TeamListItem,
} from "./team";

export {
  RunLogSourceSchema,
  RunLogLevelSchema,
  RunLogEntrySchema,
  RunLogAppendSchema,
  RunLogMetaSchema,
  type RunLogSource,
  type RunLogLevel,
  type RunLogEntry,
  type RunLogAppend,
  type RunLogMeta,
} from "./run-log";

export {
  BridgeStatusSchema,
  BridgeExecutorSchema,
  BridgeRegisterSchema,
  BridgeHeartbeatSchema,
  BridgeAuthModeSchema,
  BridgePrepareSchema,
  type BridgeStatus,
  type BridgeExecutor,
  type BridgeRegister,
  type BridgeHeartbeat,
  type BridgeAuthMode,
  type BridgePrepare,
} from "./bridge";

export {
  StudioLanguageSchema,
  StudioConfigSchema,
  StudioConfigPublicSchema,
  TeamSecretsSchema,
  TeamSecretsPublicSchema,
  type StudioLanguage,
  type StudioConfig,
  type StudioConfigPublic,
  type TeamSecrets,
  type TeamSecretsPublic,
} from "./studio";

export {
  parseOpenQuestions,
  suggestOptions,
  formatOpenQuestionFeedback,
  answersFromDefaults,
  type OpenQuestion,
  type OpenQuestionAnswer,
} from "./open-questions";
