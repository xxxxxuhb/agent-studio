import { z } from "zod";

/** Agent-generated content language (Bridge / Studio inputs). */
export const StudioLanguageSchema = z.enum(["zh", "en"]);
export type StudioLanguage = z.infer<typeof StudioLanguageSchema>;

export const StudioConfigSchema = z.object({
  /** Owning team when stored as per-team settings; empty = install default. */
  team_id: z.string().optional().default(""),
  /** When zh, agents should produce Chinese; when en, English. */
  language: StudioLanguageSchema.default("zh"),
  /** Default Bridge HTTP base URL for Studio orchestrator. */
  bridge_base_url: z.string().default("http://127.0.0.1:8787"),
  /** Default AGENTS.md path or "auto". */
  agents_md_path: z.string().default("auto"),
  /** Absolute or ~/ path used by Studio ensureCloned only (Bridge uses its own .env). */
  git_ssh_key_path: z.string().optional().default(""),
  git_prefer_ssh: z.boolean().optional(),
  git_ssh_port: z.number().int().nonnegative().optional(),
  git_ssh_user: z.string().optional().default(""),
});
export type StudioConfig = z.infer<typeof StudioConfigSchema>;

export const StudioConfigPublicSchema = StudioConfigSchema.extend({
  git_ssh_key_path_set: z.boolean().default(false),
});
export type StudioConfigPublic = z.infer<typeof StudioConfigPublicSchema>;

/**
 * Per-team overlay (file: data/team-secrets/{teamId}.yaml, mode 0600).
 * Legacy unused keys in old files are ignored via passthrough + selective read.
 */
export const TeamSecretsSchema = z
  .object({
    team_id: z.string().default(""),
    bridge_base_url: z.string().optional().default(""),
    agents_md_path: z.string().optional().default(""),
    git_ssh_key_path: z.string().optional().default(""),
    git_prefer_ssh: z.boolean().optional(),
    git_ssh_port: z.number().int().nonnegative().optional(),
    git_ssh_user: z.string().optional().default(""),
    /** Shared secret for POST /webhooks/pipelines/:id/forge (GitLab token / Studio token). */
    forge_webhook_secret: z.string().optional().default(""),
  })
  .passthrough();
export type TeamSecrets = z.infer<typeof TeamSecretsSchema>;

export const TeamSecretsPublicSchema = TeamSecretsSchema.extend({
  git_ssh_key_path_set: z.boolean().default(false),
  forge_webhook_secret_set: z.boolean().default(false),
}).omit({ forge_webhook_secret: true });
export type TeamSecretsPublic = z.infer<typeof TeamSecretsPublicSchema>;
