import { z } from "zod";

export const AuthUserPublicSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  display_name: z.string().optional().default(""),
  /** System admin: can create/configure teams and users. */
  is_admin: z.boolean().optional().default(false),
});
export type AuthUserPublic = z.infer<typeof AuthUserPublicSchema>;

export const AuthLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type AuthLogin = z.infer<typeof AuthLoginSchema>;

export const AuthRegisterSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "username must start with a letter"),
  password: z.string().min(6).max(128),
  display_name: z.string().optional().default(""),
});
export type AuthRegister = z.infer<typeof AuthRegisterSchema>;

export const AuthLoginResponseSchema = z.object({
  token: z.string().min(1),
  user: AuthUserPublicSchema,
});
export type AuthLoginResponse = z.infer<typeof AuthLoginResponseSchema>;
