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

/** Self-service profile update (display name + optional password change). */
export const AuthProfileUpdateSchema = z
  .object({
    display_name: z.string().max(128).optional(),
    current_password: z.string().min(1).optional(),
    new_password: z.string().min(6).max(128).optional(),
  })
  .superRefine((v, ctx) => {
    const changingPw = Boolean(v.new_password);
    if (changingPw && !v.current_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "修改密码需填写当前密码",
        path: ["current_password"],
      });
    }
    if (v.current_password && !v.new_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "请填写新密码",
        path: ["new_password"],
      });
    }
  });
export type AuthProfileUpdate = z.infer<typeof AuthProfileUpdateSchema>;

export const AuthProfileUpdateResponseSchema = z.object({
  user: AuthUserPublicSchema,
  /** Fresh JWT when profile fields embedded in token change. */
  token: z.string().min(1).optional(),
});
export type AuthProfileUpdateResponse = z.infer<
  typeof AuthProfileUpdateResponseSchema
>;
