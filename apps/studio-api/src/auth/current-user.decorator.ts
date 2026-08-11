import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthUserPublic } from "@agent-studio/agent-schema";

export type RequestUser = AuthUserPublic;

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
    return req.user;
  },
);
