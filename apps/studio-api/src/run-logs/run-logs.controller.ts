import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { TeamsService } from "../teams/teams.service";
import { RunLogsService } from "./run-logs.service";

@Controller("run-logs")
export class RunLogsController {
  constructor(
    @Inject(RunLogsService) private readonly logs: RunLogsService,
    @Inject(TeamsService) private readonly teams: TeamsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query("q") q?: string,
    @Query("work_order_id") work_order_id?: string,
    @Query("team_id") team_id?: string,
    @Query("limit") limit?: string,
  ) {
    const teamIds = await this.teams.resolveScopedTeamIds(user.id, team_id);
    return this.logs.list({
      q,
      work_order_id,
      team_ids: teamIds,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** Paste Studio / Bridge / work-order id → one run (exact preferred). */
  @Get("lookup")
  async lookup(
    @CurrentUser() user: RequestUser,
    @Query("q") q?: string,
    @Query("team_id") team_id?: string,
  ) {
    const needle = (q || "").trim();
    if (!needle) {
      throw new NotFoundException("lookup requires q");
    }
    const teamIds = await this.teams.resolveScopedTeamIds(user.id, team_id);
    const hit = await this.logs.lookup({ q: needle, team_ids: teamIds });
    if (!hit) {
      throw new NotFoundException(`no run log matches: ${needle}`);
    }
    const teamId = (hit.meta.team_id || "").trim();
    if (teamId) {
      await this.teams.requireMember(teamId, user.id);
    }
    return hit;
  }

  @Get(":runId")
  async get(
    @CurrentUser() user: RequestUser,
    @Param("runId") runId: string,
    @Query("source") source?: string,
    @Query("level") level?: string,
  ) {
    const detail = await this.logs.get(runId, { source, level });
    await this.assertTeamAccess(user.id, detail.meta.team_id);
    return detail;
  }

  @Get(":runId/artifacts")
  async listArtifacts(
    @CurrentUser() user: RequestUser,
    @Param("runId") runId: string,
  ) {
    const detail = await this.logs.get(runId);
    await this.assertTeamAccess(user.id, detail.meta.team_id);
    return this.logs.listArtifacts(runId);
  }

  @Get(":runId/artifacts/:name")
  async readArtifact(
    @CurrentUser() user: RequestUser,
    @Param("runId") runId: string,
    @Param("name") name: string,
  ) {
    const detail = await this.logs.get(runId);
    await this.assertTeamAccess(user.id, detail.meta.team_id);
    return this.logs.readArtifact(runId, name);
  }

  private async assertTeamAccess(userId: string, teamIdRaw: string) {
    const teamId = (teamIdRaw || "").trim();
    if (teamId) {
      await this.teams.requireMember(teamId, userId);
      return;
    }
    const mine = await this.teams.listTeamIdsForUser(userId);
    if (!mine.length) {
      throw new ForbiddenException("你不是任何团队成员");
    }
  }
}
