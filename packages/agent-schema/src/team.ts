import { z } from "zod";
import { AuthUserPublicSchema } from "./auth";

/** owner/member 可写；viewer 只读 */
export const TeamMemberRoleSchema = z.enum(["owner", "member", "viewer"]);
export type TeamMemberRole = z.infer<typeof TeamMemberRoleSchema>;

export const TeamSchema = z.object({
  id: z.string().min(1),
  slug: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, "team slug must be snake_case"),
  name: z.string().min(1),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type Team = z.infer<typeof TeamSchema>;

export const TeamCreateSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, "team slug must be snake_case"),
  name: z.string().min(1),
});
export type TeamCreate = z.infer<typeof TeamCreateSchema>;

export const TeamMemberSchema = z.object({
  team_id: z.string().min(1),
  user_id: z.string().min(1),
  role: TeamMemberRoleSchema,
  username: z.string().optional().default(""),
  display_name: z.string().optional().default(""),
  created_at: z.string().optional(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const TeamMemberAddSchema = z.object({
  username: z.string().min(1),
  role: TeamMemberRoleSchema.optional().default("member"),
});
export type TeamMemberAdd = z.infer<typeof TeamMemberAddSchema>;

export const TeamMemberUpdateSchema = z.object({
  role: TeamMemberRoleSchema,
});
export type TeamMemberUpdate = z.infer<typeof TeamMemberUpdateSchema>;

export const TeamDetailSchema = TeamSchema.extend({
  members: z.array(TeamMemberSchema).default([]),
  my_role: TeamMemberRoleSchema.optional(),
});
export type TeamDetail = z.infer<typeof TeamDetailSchema>;

export const TeamListItemSchema = TeamSchema.extend({
  my_role: TeamMemberRoleSchema.optional(),
  member_count: z.number().int().nonnegative().optional().default(0),
});
export type TeamListItem = z.infer<typeof TeamListItemSchema>;

export { AuthUserPublicSchema };
