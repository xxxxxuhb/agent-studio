import {
  Controller,
  Get,
  Query,
  BadRequestException,
} from "@nestjs/common";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { TeamsService } from "../teams/teams.service";
import { AuditService } from "./audit.service";

@Controller("audit-logs")
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly teams: TeamsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id?: string,
    @Query("actor_user_id") actor_user_id?: string,
    @Query("action") action?: string,
    @Query("limit") limit?: string,
  ) {
    const tid = (team_id || "").trim();
    if (!tid) throw new BadRequestException("team_id is required");
    await this.teams.requireMember(tid, user.id);
    return this.audit.list({
      team_id: tid,
      actor_user_id: (actor_user_id || "").trim() || undefined,
      action: (action || "").trim() || undefined,
      limit: limit ? Number(limit) : 50,
    });
  }
}
