import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from "@nestjs/common";
import { SystemNotificationMarkReadSchema } from "@agent-studio/agent-schema";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { TeamsService } from "../teams/teams.service";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly teams: TeamsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id?: string,
    @Query("unread_only") unread_only?: string,
    @Query("limit") limit?: string,
  ) {
    const tid = (team_id || "").trim();
    if (!tid) throw new BadRequestException("team_id is required");
    await this.teams.requireMember(tid, user.id);
    return this.notifications.listForUser(user.id, tid, {
      unread_only: unread_only === "1" || unread_only === "true",
      limit: limit ? Number(limit) : 40,
    });
  }

  @Post("read")
  async markRead(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id: string | undefined,
    @Body() body: unknown,
  ) {
    const tid = (team_id || "").trim();
    if (!tid) throw new BadRequestException("team_id is required");
    await this.teams.requireMember(tid, user.id);
    let ids: string[];
    try {
      ids = SystemNotificationMarkReadSchema.parse(body).ids;
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
    return this.notifications.markRead(user.id, tid, ids);
  }

  @Post("read-all")
  async markAllRead(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id?: string,
  ) {
    const tid = (team_id || "").trim();
    if (!tid) throw new BadRequestException("team_id is required");
    await this.teams.requireMember(tid, user.id);
    return this.notifications.markAllRead(user.id, tid);
  }
}
