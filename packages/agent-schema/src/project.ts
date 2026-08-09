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

export const ProjectRepoSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, "repo id must be snake_case"),
  name: z.string().min(1),
  /** git remote URL (https / ssh) */
  remote_url: z.string().min(1),
  /**
   * Absolute or project-relative local path after clone.
   * Empty → {clone_root}/{repo.id}
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
export type ProjectRepo = z.infer<typeof ProjectRepoSchema>;

export const ProjectRepoCreateSchema = ProjectRepoSchema.omit({
  clone_status: true,
  clone_error: true,
  last_synced_at: true,
}).extend({
  clone_status: ProjectRepoCloneStatusSchema.optional(),
});
export type ProjectRepoCreate = z.infer<typeof ProjectRepoCreateSchema>;

export const ProjectSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, "project id must be snake_case"),
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
});
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
