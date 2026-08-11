import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC_KEY } from "./public.decorator";
import type { RequestUser } from "./current-user.decorator";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // WebSocket / non-HTTP contexts: skip (Bridge uses its own token)
    if (context.getType() !== "http") return true;

    const req = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: RequestUser;
    }>();
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      throw new UnauthorizedException("missing bearer token");
    }
    try {
      const payload = this.jwt.verify<{
        sub: string;
        username: string;
        display_name?: string;
        is_admin?: boolean;
      }>(match[1]);
      req.user = {
        id: payload.sub,
        username: payload.username,
        display_name: payload.display_name || "",
        is_admin: Boolean(payload.is_admin),
      };
      return true;
    } catch {
      throw new UnauthorizedException("invalid or expired token");
    }
  }
}
