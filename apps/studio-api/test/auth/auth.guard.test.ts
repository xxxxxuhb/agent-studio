import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { AuthGuard } from "../../dist/auth/auth.guard";

function httpContext(opts: {
  authorization?: string;
  type?: "http" | "ws";
}): {
  ctx: ExecutionContext;
  req: { headers: { authorization?: string }; user?: unknown };
} {
  const req: { headers: { authorization?: string }; user?: unknown } = {
    headers: { authorization: opts.authorization },
  };
  const ctx = {
    getType: () => opts.type || "http",
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe("AuthGuard", () => {
  const secret = "test-studio-jwt-secret";
  const jwt = new JwtService({ secret });

  function guard(isPublic = false) {
    const reflector = {
      getAllAndOverride: () => isPublic,
    } as unknown as Reflector;
    return new AuthGuard(jwt, reflector);
  }

  it("rejects missing bearer token with 401", () => {
    const g = guard(false);
    const { ctx } = httpContext({});
    assert.throws(
      () => g.canActivate(ctx),
      (err: unknown) =>
        err instanceof UnauthorizedException &&
        String((err as UnauthorizedException).message).includes(
          "missing bearer token",
        ),
    );
  });

  it("rejects invalid token with 401", () => {
    const g = guard(false);
    const { ctx } = httpContext({ authorization: "Bearer not-a-jwt" });
    assert.throws(
      () => g.canActivate(ctx),
      (err: unknown) =>
        err instanceof UnauthorizedException &&
        String((err as UnauthorizedException).message).includes(
          "invalid or expired token",
        ),
    );
  });

  it("accepts valid bearer and sets req.user", () => {
    const token = jwt.sign({
      sub: "u-1",
      username: "alice",
      display_name: "Alice",
      is_admin: true,
    });
    const g = guard(false);
    const { ctx, req } = httpContext({ authorization: `Bearer ${token}` });
    assert.equal(g.canActivate(ctx), true);
    assert.deepEqual(req.user, {
      id: "u-1",
      username: "alice",
      display_name: "Alice",
      is_admin: true,
    });
  });

  it("skips auth for @Public routes", () => {
    const g = guard(true);
    const { ctx } = httpContext({});
    assert.equal(g.canActivate(ctx), true);
  });

  it("skips auth for non-http contexts", () => {
    const g = guard(false);
    const { ctx } = httpContext({ type: "ws" });
    assert.equal(g.canActivate(ctx), true);
  });
});
