import { z } from "zod";

export const ProjectRepoRoleSchema = z.enum([
  "frontend",
  "backend",
  "fullstack",
  "docs",
  "infra",
  "unknown",
]);
export type ProjectRepoRole = z.infer<typeof ProjectRepoRoleSchema>;

export const ProjectRepoCloneStatusSchema = z.enum([
  "pending",
  "ready",
  "missing",
  "error",
]);
export type ProjectRepoCloneStatus = z.infer<typeof ProjectRepoCloneStatusSchema>;

export const ProjectRepoObjectSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, "repo id must be snake_case"),
  name: z.string().min(1),
  /**
   * git remote URL (https / ssh). Optional when `local_path` points at an
   * already-cloned checkout (Bridge / Studio will skip clone if `.git` exists).
   */
  remote_url: z.string().optional().default(""),
  /**
   * Absolute or project-relative local path after clone / for existing checkout.
   * Empty → {clone_root}/{repo.id}
   * Absolute path on the Bridge host reuses that directory for pipeline runs.
   */
  local_path: z.string().optional().default(""),
  role: ProjectRepoRoleSchema.default("unknown"),
  /** Path to AGENTS.md relative to local_path, default AGENTS.md */
  agents_md: z.string().optional().default("AGENTS.md"),
  default_branch: z.string().optional().default("main"),
  note: z.string().optional().default(""),
  clone_status: ProjectRepoCloneStatusSchema.optional().default("pending"),
  clone_error: z.string().optional().default(""),
  last_synced_at: z.string().optional(),
});

function refineRepoSource<T extends { remote_url?: string; local_path?: string }>(
  repo: T,
  ctx: z.RefinementCtx,
) {
  if (!(repo.remote_url || "").trim() && !(repo.local_path || "").trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "remote_url 或 local_path 至少填写一个",
      path: ["remote_url"],
    });
  }
}

export const ProjectRepoSchema = ProjectRepoObjectSchema.superRefine(refineRepoSource);
export type ProjectRepo = z.infer<typeof ProjectRepoSchema>;

export const ProjectRepoCreateSchema = ProjectRepoObjectSchema.omit({
  clone_status: true,
  clone_error: true,
  last_synced_at: true,
})
  .extend({
    clone_status: ProjectRepoCloneStatusSchema.optional(),
  })
  .superRefine(refineRepoSource);
export type ProjectRepoCreate = z.infer<typeof ProjectRepoCreateSchema>;

export const ProjectSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, "project id must be snake_case"),
  /** Owning team (tenant). Required for MySQL-backed projects. */
  team_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  /**
   * Root directory where this project's repos are cloned.
   * Empty → {STUDIO_REPOS_DIR}/{project.id}
   * STUDIO_REPOS_DIR default: ~/AgentStudio (macOS/Linux) or C:\.agent-studio (Windows)
   */
  clone_root: z.string().optional().default(""),
  repos: z.array(ProjectRepoSchema).default([]),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectCreateSchema = ProjectSchema.omit({
  created_at: true,
  updated_at: true,
}).extend({
  repos: z.array(ProjectRepoCreateSchema).default([]),
});
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = ProjectCreateSchema.partial().omit({
  id: true,
  team_id: true,
});
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
