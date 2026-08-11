import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Repository } from "typeorm";
import type { AuthService } from "../../dist/auth/auth.service";
import type { UserEntity } from "../../dist/auth/entities/user.entity";
import type { TeamEntity } from "../../dist/teams/entities/team.entity";
import type { TeamMemberEntity } from "../../dist/teams/entities/team-member.entity";
import { TeamsService } from "../../dist/teams/teams.service";

function member(
  partial: Partial<TeamMemberEntity> & {
    team_id: string;
    user_id: string;
    role: "owner" | "member" | "viewer";
  },
): TeamMemberEntity {
  return {
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    ...partial,
  } as TeamMemberEntity;
}

function makeService(opts: {
  memberships?: TeamMemberEntity[];
  teams?: TeamEntity[];
  users?: Array<Partial<UserEntity> & { id: string }>;
}) {
  const memberships = opts.memberships || [];
  const teams = opts.teams || [];
  const users = opts.users || [];

  const membersRepo = {
    findOne: async (args: { where: { team_id: string; user_id: string } }) => {
      const { team_id, user_id } = args.where;
      return (
        memberships.find(
          (m) => m.team_id === team_id && m.user_id === user_id,
        ) || null
      );
    },
    find: async (args: { where: { user_id?: string; team_id?: string } }) => {
      const { user_id, team_id } = args.where;
      return memberships.filter((m) => {
        if (user_id && m.user_id !== user_id) return false;
        if (team_id && m.team_id !== team_id) return false;
        return true;
      });
    },
  } as unknown as Repository<TeamMemberEntity>;

  const teamsRepo = {
    findOne: async (args: { where: { id: string } }) =>
      teams.find((t) => t.id === args.where.id) || null,
    find: async () => teams,
  } as unknown as Repository<TeamEntity>;

  const auth = {
    findById: async (id: string) =>
      (users.find((u) => u.id === id) as UserEntity | undefined) || null,
    assertAdmin: async (userId: string) => {
      const u = users.find((x) => x.id === userId);
      if (!u) throw new NotFoundException("user not found");
      if (!u.is_admin) {
        throw new ForbiddenException("仅系统管理员可配置团队");
      }
      return u as UserEntity;
    },
  } as unknown as AuthService;

  return new TeamsService(teamsRepo, membersRepo, auth);
}

describe("TeamsService ACL", () => {
  const teamA = "team-a";
  const teamB = "team-b";

  it("requireMember rejects non-members", async () => {
    const svc = makeService({ memberships: [] });
    await assert.rejects(
      () => svc.requireMember(teamA, "u-1"),
      (err: unknown) =>
        err instanceof ForbiddenException &&
        String(err.message).includes("不是该团队成员"),
    );
  });

  it("requireMember accepts any role", async () => {
    for (const role of ["owner", "member", "viewer"] as const) {
      const svc = makeService({
        memberships: [member({ team_id: teamA, user_id: "u-1", role })],
      });
      const row = await svc.requireMember(teamA, "u-1");
      assert.equal(row.role, role);
    }
  });

  it("requireWritableMember blocks viewer", async () => {
    const svc = makeService({
      memberships: [
        member({ team_id: teamA, user_id: "viewer", role: "viewer" }),
        member({ team_id: teamA, user_id: "member", role: "member" }),
      ],
    });
    await assert.rejects(
      () => svc.requireWritableMember(teamA, "viewer"),
      (err: unknown) =>
        err instanceof ForbiddenException &&
        String(err.message).includes("viewer"),
    );
    const ok = await svc.requireWritableMember(teamA, "member");
    assert.equal(ok.role, "member");
  });

  it("requireOwner only allows owner", async () => {
    const svc = makeService({
      memberships: [
        member({ team_id: teamA, user_id: "owner", role: "owner" }),
        member({ team_id: teamA, user_id: "member", role: "member" }),
      ],
    });
    await assert.rejects(
      () => svc.requireOwner(teamA, "member"),
      (err: unknown) =>
        err instanceof ForbiddenException &&
        String(err.message).includes("owner"),
    );
    const ok = await svc.requireOwner(teamA, "owner");
    assert.equal(ok.role, "owner");
  });

  it("resolveScopedTeamIds isolates teams", async () => {
    const svc = makeService({
      memberships: [
        member({ team_id: teamA, user_id: "u-1", role: "member" }),
        member({ team_id: teamB, user_id: "u-2", role: "member" }),
      ],
    });
    assert.deepEqual(await svc.resolveScopedTeamIds("u-1"), [teamA]);
    assert.deepEqual(await svc.resolveScopedTeamIds("u-1", teamA), [teamA]);
    await assert.rejects(
      () => svc.resolveScopedTeamIds("u-1", teamB),
      ForbiddenException,
    );
  });

  it("getDetail allows admin bypass and blocks outsiders", async () => {
    const teamEntity = {
      id: teamA,
      slug: "a",
      name: "Team A",
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    } as TeamEntity;
    const svc = makeService({
      teams: [teamEntity],
      memberships: [
        member({ team_id: teamA, user_id: "member", role: "member" }),
      ],
      users: [
        { id: "member", username: "m", is_admin: false },
        { id: "outsider", username: "o", is_admin: false },
        { id: "admin", username: "a", is_admin: true },
      ],
    });

    await assert.rejects(
      () => svc.getDetail(teamA, "outsider"),
      ForbiddenException,
    );
    const asMember = await svc.getDetail(teamA, "member");
    assert.equal(asMember.my_role, "member");
    const asAdmin = await svc.getDetail(teamA, "admin");
    assert.equal(asAdmin.id, teamA);
    assert.equal(asAdmin.my_role, undefined);
  });

  it("assertTeamAccess returns role", async () => {
    const svc = makeService({
      memberships: [
        member({ team_id: teamA, user_id: "u-1", role: "viewer" }),
      ],
    });
    assert.equal(await svc.assertTeamAccess(teamA, "u-1"), "viewer");
  });
});
