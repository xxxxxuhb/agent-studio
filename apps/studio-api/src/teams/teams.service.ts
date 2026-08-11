import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { In, Repository } from "typeorm";
import {
  TeamCreateSchema,
  TeamMemberAddSchema,
  TeamMemberUpdateSchema,
  type TeamDetail,
  type TeamListItem,
  type TeamMember,
  type TeamMemberRole,
} from "@agent-studio/agent-schema";
import { AuthService } from "../auth/auth.service";
import { TeamEntity } from "./entities/team.entity";
import { TeamMemberEntity } from "./entities/team-member.entity";

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(TeamEntity)
    private readonly teams: Repository<TeamEntity>,
    @InjectRepository(TeamMemberEntity)
    private readonly members: Repository<TeamMemberEntity>,
    private readonly auth: AuthService,
  ) {}

  private toIso(d?: Date | null) {
    return d ? d.toISOString() : undefined;
  }

  async listForUser(userId: string): Promise<TeamListItem[]> {
    const mine = await this.members.find({ where: { user_id: userId } });
    if (!mine.length) return [];
    return this.mapTeamList(
      mine.map((m) => m.team_id),
      new Map(mine.map((m) => [m.team_id, m.role])),
    );
  }

  /** Admin: all teams (for configuration UI). */
  async listAllForAdmin(adminUserId: string): Promise<TeamListItem[]> {
    await this.auth.assertAdmin(adminUserId);
    const teams = await this.teams.find();
    const mine = await this.members.find({ where: { user_id: adminUserId } });
    const roleByTeam = new Map(mine.map((m) => [m.team_id, m.role]));
    return this.mapTeamList(
      teams.map((t) => t.id),
      roleByTeam,
    );
  }

  private async mapTeamList(
    teamIds: string[],
    roleByTeam: Map<string, TeamMemberRole>,
  ): Promise<TeamListItem[]> {
    if (!teamIds.length) return [];
    const teams = await this.teams.find({ where: { id: In(teamIds) } });
    const counts = await this.members
      .createQueryBuilder("m")
      .select("m.team_id", "team_id")
      .addSelect("COUNT(*)", "cnt")
      .where("m.team_id IN (:...ids)", { ids: teamIds })
      .groupBy("m.team_id")
      .getRawMany<{ team_id: string; cnt: string }>();
    const countMap = new Map(counts.map((c) => [c.team_id, Number(c.cnt)]));
    return teams
      .map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        created_at: this.toIso(t.created_at),
        updated_at: this.toIso(t.updated_at),
        my_role: roleByTeam.get(t.id),
        member_count: countMap.get(t.id) || 0,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async getDetail(teamId: string, userId: string): Promise<TeamDetail> {
    const user = await this.auth.findById(userId);
    if (!user) throw new NotFoundException("user not found");
    const membership = await this.getMembership(teamId, userId);
    if (!membership && !user.is_admin) {
      throw new ForbiddenException("你不是该团队成员");
    }
    const team = await this.teams.findOne({ where: { id: teamId } });
    if (!team) throw new NotFoundException(`team not found: ${teamId}`);
    const rows = await this.members.find({ where: { team_id: teamId } });
    const members: TeamMember[] = [];
    for (const row of rows) {
      const memberUser = await this.auth.findById(row.user_id);
      members.push({
        team_id: row.team_id,
        user_id: row.user_id,
        role: row.role,
        username: memberUser?.username || "",
        display_name: memberUser?.display_name || "",
        created_at: this.toIso(row.created_at),
      });
    }
    return {
      id: team.id,
      slug: team.slug,
      name: team.name,
      created_at: this.toIso(team.created_at),
      updated_at: this.toIso(team.updated_at),
      members,
      my_role: membership?.role,
    };
  }

  async create(userId: string, input: unknown): Promise<TeamDetail> {
    await this.auth.assertAdmin(userId);
    const body = TeamCreateSchema.parse(input);
    const existing = await this.teams.findOne({ where: { slug: body.slug } });
    if (existing) {
      throw new ConflictException(`team slug already exists: ${body.slug}`);
    }
    const team = await this.teams.save(
      this.teams.create({
        id: randomUUID(),
        slug: body.slug,
        name: body.name,
      }),
    );
    // Admin becomes owner so they can also enter the team workspace
    await this.members.save(
      this.members.create({
        team_id: team.id,
        user_id: userId,
        role: "owner",
      }),
    );
    return this.getDetail(team.id, userId);
  }

  async addMember(teamId: string, actorId: string, input: unknown) {
    await this.auth.assertAdmin(actorId);
    const body = TeamMemberAddSchema.parse(input);
    const user = await this.auth.findByUsername(body.username);
    if (!user) {
      // 400（不是 404）：避免前端把「用户不存在」误当成 /members 路由不存在
      throw new BadRequestException(
        `用户不存在: ${body.username}（请先点「创建用户」再建账号）`,
      );
    }
    const existing = await this.members.findOne({
      where: { team_id: teamId, user_id: user.id },
    });
    if (existing) {
      throw new ConflictException(`用户已在团队中: ${body.username}`);
    }
    await this.members.save(
      this.members.create({
        team_id: teamId,
        user_id: user.id,
        role: body.role || "member",
      }),
    );
    return this.getDetail(teamId, actorId);
  }

  async updateMember(
    teamId: string,
    actorId: string,
    memberUserId: string,
    input: unknown,
  ) {
    await this.auth.assertAdmin(actorId);
    const body = TeamMemberUpdateSchema.parse(input);
    const row = await this.members.findOne({
      where: { team_id: teamId, user_id: memberUserId },
    });
    if (!row) throw new NotFoundException("成员不存在");
    if (row.role === "owner" && body.role !== "owner") {
      const owners = await this.members.count({
        where: { team_id: teamId, role: "owner" },
      });
      if (owners <= 1) {
        throw new BadRequestException("不能移除最后一个 owner");
      }
    }
    row.role = body.role;
    await this.members.save(row);
    return this.getDetail(teamId, actorId);
  }

  async removeMember(teamId: string, actorId: string, memberUserId: string) {
    await this.auth.assertAdmin(actorId);
    const row = await this.members.findOne({
      where: { team_id: teamId, user_id: memberUserId },
    });
    if (!row) throw new NotFoundException("成员不存在");
    if (row.role === "owner") {
      const owners = await this.members.count({
        where: { team_id: teamId, role: "owner" },
      });
      if (owners <= 1) {
        throw new BadRequestException("不能移除最后一个 owner");
      }
    }
    await this.members.remove(row);
    return this.getDetail(teamId, actorId);
  }

  /** System admin creates a Studio login for inviting to teams. */
  async createUserAccount(
    actorId: string,
    input: { username: string; password: string; display_name?: string },
  ) {
    await this.auth.assertAdmin(actorId);
    return this.auth.createUser(input);
  }

  async listTeamIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.members.find({ where: { user_id: userId } });
    return rows.map((r) => r.team_id);
  }

  async getMembership(
    teamId: string,
    userId: string,
  ): Promise<TeamMemberEntity | null> {
    return this.members.findOne({ where: { team_id: teamId, user_id: userId } });
  }

  async requireMember(
    teamId: string,
    userId: string,
  ): Promise<TeamMemberEntity> {
    const m = await this.getMembership(teamId, userId);
    if (!m) throw new ForbiddenException("你不是该团队成员");
    return m;
  }

  /** member/owner may mutate team resources; viewer is read-only. */
  async requireWritableMember(
    teamId: string,
    userId: string,
  ): Promise<TeamMemberEntity> {
    const m = await this.requireMember(teamId, userId);
    if (m.role === "viewer") {
      throw new ForbiddenException("只读成员（viewer）不能修改团队资源");
    }
    return m;
  }

  /**
   * Teams the user may see. If `teamId` is set, must be a member of that team.
   */
  async resolveScopedTeamIds(
    userId: string,
    teamId?: string,
  ): Promise<string[]> {
    const mine = await this.listTeamIdsForUser(userId);
    if (!teamId) return mine;
    if (!mine.includes(teamId)) {
      throw new ForbiddenException("你不是该团队成员");
    }
    return [teamId];
  }

  async requireOwner(teamId: string, userId: string): Promise<TeamMemberEntity> {
    const m = await this.requireMember(teamId, userId);
    if (m.role !== "owner") {
      throw new ForbiddenException("需要团队 owner 权限");
    }
    return m;
  }

  async assertTeamAccess(teamId: string, userId: string): Promise<TeamMemberRole> {
    const m = await this.requireMember(teamId, userId);
    return m.role;
  }
}
