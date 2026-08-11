import { z } from "zod";

export const DifyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  api_base: z.string().default("http://localhost/v1"),
  api_key: z.string().default(""),
  /** Default Bridge URL passed into delivery-pipeline inputs */
  bridge_base_url: z.string().default("http://host.docker.internal:8787"),
  /** Default AGENTS.md path or "auto" */
  agents_md_path: z.string().default("auto"),
  /** Prefer streaming start so we can return before human-input pause */
  response_mode: z.enum(["streaming", "blocking"]).default("streaming"),
  /**
   * Dify Console API base for DSL import (not App API).
   * Empty → derived from api_base origin + /console/api
   */
  console_base: z.string().optional().default(""),
  /** Console account email (for login; password is never stored). */
  console_email: z.string().optional().default(""),
  /** Console access token (from email/password login or manual paste). */
  console_token: z.string().optional().default(""),
  /** CSRF token for newer Dify Console (cookie-based auth). */
  console_csrf: z.string().optional().default(""),
});
export type DifyConfig = z.infer<typeof DifyConfigSchema>;

export const DifyConfigPublicSchema = DifyConfigSchema.extend({
  api_key_set: z.boolean().default(false),
  console_token_set: z.boolean().default(false),
}).omit({ api_key: true, console_token: true, console_csrf: true });
export type DifyConfigPublic = z.infer<typeof DifyConfigPublicSchema>;

/** Per-team secret overlays (file: data/team-secrets/{teamId}.yaml, mode 0600). */
export const TeamSecretsSchema = z.object({
  team_id: z.string().default(""),
  /** When set, overrides install enabled for this team. */
  enabled: z.boolean().optional(),
  api_base: z.string().optional().default(""),
  api_key: z.string().optional().default(""),
  bridge_base_url: z.string().optional().default(""),
  agents_md_path: z.string().optional().default(""),
  response_mode: z.enum(["streaming", "blocking"]).optional(),
  console_base: z.string().optional().default(""),
  console_email: z.string().optional().default(""),
  console_token: z.string().optional().default(""),
  console_csrf: z.string().optional().default(""),
  /** Absolute or ~/ path used by Studio ensureCloned only (Bridge uses its own .env). */
  git_ssh_key_path: z.string().optional().default(""),
  git_prefer_ssh: z.boolean().optional(),
  git_ssh_port: z.number().int().nonnegative().optional(),
  git_ssh_user: z.string().optional().default(""),
});
export type TeamSecrets = z.infer<typeof TeamSecretsSchema>;

export const TeamSecretsPublicSchema = TeamSecretsSchema.extend({
  api_key_set: z.boolean().default(false),
  console_token_set: z.boolean().default(false),
  git_ssh_key_path_set: z.boolean().default(false),
}).omit({
  api_key: true,
  console_token: true,
  console_csrf: true,
});
export type TeamSecretsPublic = z.infer<typeof TeamSecretsPublicSchema>;

export const DifyConfigPublicForTeamSchema = DifyConfigPublicSchema.extend({
  team_id: z.string().default(""),
  api_key_scope: z.enum(["team", "install", "none"]).default("none"),
  console_token_scope: z.enum(["team", "install", "none"]).default("none"),
  git_ssh_key_path: z.string().optional().default(""),
  git_ssh_key_path_set: z.boolean().default(false),
  git_prefer_ssh: z.boolean().optional(),
  git_ssh_port: z.number().int().nonnegative().optional(),
  git_ssh_user: z.string().optional().default(""),
});
export type DifyConfigPublicForTeam = z.infer<typeof DifyConfigPublicForTeamSchema>;

/**
 * Per-pipeline Dify Workflow App binding.
 * One Studio pipeline ↔ one Dify Workflow App (API Key).
 */
export const PipelineDifyBindingSchema = z.object({
  /** When true, Dify runs for this pipeline use this App Key (not the global default). */
  enabled: z.boolean().default(false),
  /** Optional override; empty → use global api_base */
  api_base: z.string().optional().default(""),
  /** Workflow App API Key (app-...) */
  api_key: z.string().optional().default(""),
  /** Optional Dify app id for display / future DSL sync */
  app_id: z.string().optional().default(""),
  /** Optional workflow id */
  workflow_id: z.string().optional().default(""),
  note: z.string().optional().default(""),
});
export type PipelineDifyBinding = z.infer<typeof PipelineDifyBindingSchema>;

export const PipelineDifyBindingPublicSchema = PipelineDifyBindingSchema.extend({
  api_key_set: z.boolean().default(false),
}).omit({ api_key: true });
export type PipelineDifyBindingPublic = z.infer<typeof PipelineDifyBindingPublicSchema>;

/**
 * Per digital-human ↔ Dify Agent mapping (node / agent app).
 */
export const DigitalHumanDifyBindingSchema = z.object({
  /** Dify Agent app id or workflow node id/name */
  agent_id: z.string().optional().default(""),
  /** Display name inside Dify */
  agent_name: z.string().optional().default(""),
  note: z.string().optional().default(""),
});
export type DigitalHumanDifyBinding = z.infer<typeof DigitalHumanDifyBindingSchema>;
