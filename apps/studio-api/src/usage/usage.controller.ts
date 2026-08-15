import {
  Controller,
  Get,
  Query,
  BadRequestException,
} from "@nestjs/common";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { TeamsService } from "../teams/teams.service";
import { UsageService } from "./usage.service";

@Controller("usage")
export class UsageController {
  constructor(
    private readonly usage: UsageService,
    private readonly teams: TeamsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id?: string,
    @Query("work_order_id") work_order_id?: string,
    @Query("driver") driver?: string,
    @Query("limit") limit?: string,
  ) {
    const tid = (team_id || "").trim();
    if (!tid) throw new BadRequestException("team_id is required");
    await this.teams.requireMember(tid, user.id);
    return this.usage.list({
      team_id: tid,
      work_order_id: (work_order_id || "").trim() || undefined,
      driver: (driver || "").trim() || undefined,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get("summary")
  async summary(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id?: string,
  ) {
    const tid = (team_id || "").trim();
    if (!tid) throw new BadRequestException("team_id is required");
    await this.teams.requireMember(tid, user.id);
    return this.usage.summarize({ team_id: tid });
  }
}
