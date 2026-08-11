import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Repository } from "typeorm";
import { AuthService } from "../../dist/auth/auth.service";
import type { UserEntity } from "../../dist/auth/entities/user.entity";

describe("AuthService.assertAdmin", () => {
  function service(users: Array<Partial<UserEntity> & { id: string }>) {
    const usersRepo = {
      findOne: async (args: { where: { id: string } }) =>
        (users.find((u) => u.id === args.where.id) as UserEntity | undefined) ||
        null,
    } as unknown as Repository<UserEntity>;
    return new AuthService(usersRepo, new JwtService({ secret: "x" }));
  }

  it("rejects missing user", async () => {
    const svc = service([]);
    await assert.rejects(
      () => svc.assertAdmin("missing"),
      UnauthorizedException,
    );
  });

  it("rejects non-admin", async () => {
    const svc = service([
      { id: "u-1", username: "bob", is_admin: false, password_hash: "x" },
    ]);
    await assert.rejects(
      () => svc.assertAdmin("u-1"),
      (err: unknown) =>
        err instanceof ForbiddenException &&
        String(err.message).includes("系统管理员"),
    );
  });

  it("allows admin", async () => {
    const svc = service([
      { id: "u-1", username: "admin", is_admin: true, password_hash: "x" },
    ]);
    const user = await svc.assertAdmin("u-1");
    assert.equal(user.username, "admin");
  });
});
