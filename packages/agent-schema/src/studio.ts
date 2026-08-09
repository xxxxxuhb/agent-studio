import { z } from "zod";

/** Agent-generated content language (local stubs + Dify/Bridge inputs). */
export const StudioLanguageSchema = z.enum(["zh", "en"]);
export type StudioLanguage = z.infer<typeof StudioLanguageSchema>;

export const StudioConfigSchema = z.object({
  /** When zh, agents should produce Chinese; when en, English. */
  language: StudioLanguageSchema.default("zh"),
});
export type StudioConfig = z.infer<typeof StudioConfigSchema>;
