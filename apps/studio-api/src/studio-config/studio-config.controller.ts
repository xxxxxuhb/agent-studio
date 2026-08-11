import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Put,
  Query,
} from "@nestjs/common";
import type { StudioConfig } from "@agent-studio/agent-schema";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { TeamsService } from "../teams/teams.service";
import { StudioConfigService } from "./studio-config.service";

@Controller("settings")
export class StudioConfigController {
  constructor(
    @Inject(StudioConfigService) private readonly config: StudioConfigService,
    @Inject(TeamsService) private readonly teams: TeamsService,
  ) {}

  private requireTeamId(team_id?: string) {
    const tid = (team_id || "").trim();
    if (!tid) throw new BadRequestException("team_id query is required");
    return tid;
  }

  @Get()
  async get(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id?: string,
  ) {
    const tid = this.requireTeamId(team_id);
    await this.teams.requireMember(tid, user.id);
    return this.config.getForTeam(tid);
  }

  @Put()
  async update(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id: string | undefined,
    @Body() body: Partial<StudioConfig>,
  ) {
    const tid = this.requireTeamId(team_id);
    await this.teams.requireWritableMember(tid, user.id);
    return this.config.updateForTeam(tid, body);
  }
}
