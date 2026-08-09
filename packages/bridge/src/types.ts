import { z } from "zod";

export const StageSchema = z.enum([
  "manager",
  "requirement",
  "plan",
  "dev",
  "review",
  "test",
  "release_test",
]);
export type Stage = z.infer<typeof StageSchema>;

export const AgentsConfigSchema = z.object({
  project: z.object({
    name: z.string(),
    repo_path: z.string(),
    default_branch: z.string().default("main"),
    role: z.enum(["frontend", "backend", "fullstack", "unknown"]).optional(),
    remote: z.string().optional(),
    depends_on: z.array(z.string()).optional(),
  }),
  pipeline: z.object({
    runs_dir: z.string(),
    requirement_doc: z.string(),
    plan_doc: z.string(),
    dev_summary: z.string(),
    review_doc: z
      .string()
      .optional()
      .default("docs/dify-runs/{run_id}/review-report.md"),
    test_report: z.string(),
    release_notes: z.string(),
    status_doc: z.string(),
  }),
  commands: z
    .object({
      install: z.string().optional().default(""),
      test: z.string().optional().default(""),
      lint: z.string().optional().default(""),
      deploy_staging: z.string().optional().default(""),
      smoke_staging: z.string().optional().default(""),
    })
    .default({}),
  release: z
    .object({
      target: z.string().default("staging"),
      production: z.string().default("disabled"),
    })
    .default({ target: "staging", production: "disabled" }),
  constraints: z
    .object({
      require_human_approval_each_stage: z.boolean().default(true),
      forbidden_paths: z.array(z.string()).default([]),
    })
    .default({}),
});
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;

export type RunStatus =
  | "created"
  | "requirement_pending_approval"
  | "plan_pending_approval"
  | "dev_pending_approval"
  | "review_pending_approval"
  | "test_pending_approval"
  | "release_pending_approval"
  | "completed"
  | "rejected"
  | "failed";

export interface RunRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  agentsMdPath: string;
  repoPath: string;
  rawRequirement: string;
  status: RunStatus;
  currentStage: Stage;
  feedback: string;
  lastSummary: string;
  artifacts: Record<string, string>;
  agentDriver?: string;
  cursorAgentId?: string;
  routing?: {
    projectName: string;
    role: string;
    score: number;
    reasons: string[];
    overriddenHint?: string;
    candidates: Array<{
      projectName: string;
      role: string;
      agentsMdPath: string;
      score: number;
    }>;
  };
}

export interface StageResult {
  runId: string;
  stage: Stage;
  status: "ok" | "error";
  summary: string;
  artifacts: string[];
  pendingHumanApproval: boolean;
  raw?: string;
  driver?: string;
  dryRun?: boolean;
}
