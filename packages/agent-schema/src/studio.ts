import { z } from "zod";

/** Agent-generated content language (local stubs + Dify/Bridge inputs). */
export const StudioLanguageSchema = z.enum(["zh", "en"]);
export type StudioLanguage = z.infer<typeof StudioLanguageSchema>;

export const StudioConfigSchema = z.object({
  /** Owning team when stored as per-team settings; empty = install default. */
  team_id: z.string().optional().default(""),
  /** When zh, agents should produce Chinese; when en, English. */
  language: StudioLanguageSchema.default("zh"),
});
export type StudioConfig = z.infer<typeof StudioConfigSchema>;
