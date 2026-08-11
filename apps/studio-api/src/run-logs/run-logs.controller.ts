import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
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

  @Get(":runId")
  async get(
    @CurrentUser() user: RequestUser,
    @Param("runId") runId: string,
    @Query("source") source?: string,
    @Query("level") level?: string,
  ) {
    const detail = await this.logs.get(runId, { source, level });
    const teamId = (detail.meta.team_id || "").trim();
    if (teamId) {
      await this.teams.requireMember(teamId, user.id);
      return detail;
    }
    const mine = await this.teams.listTeamIdsForUser(user.id);
    if (!mine.length) {
      throw new ForbiddenException("你不是任何团队成员");
    }
    return detail;
  }
}
