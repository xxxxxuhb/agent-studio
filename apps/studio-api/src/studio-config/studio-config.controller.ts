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
import { AuditService } from "../audit/audit.service";
import { TeamsService } from "../teams/teams.service";
import { StudioConfigService } from "./studio-config.service";

@Controller("settings")
export class StudioConfigController {
  constructor(
    @Inject(StudioConfigService) private readonly config: StudioConfigService,
    @Inject(TeamsService) private readonly teams: TeamsService,
    private readonly audit: AuditService,
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
    return this.config.getPublic(tid);
  }

  @Put()
  async update(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id: string | undefined,
    @Body() body: Partial<StudioConfig>,
  ) {
    const tid = this.requireTeamId(team_id);
    await this.teams.requireWritableMember(tid, user.id);
    const keys = Object.keys(body || {}).filter(Boolean);
    const secretKeys = keys.filter((k) =>
      /secret|ssh_key|password|token|api_key/i.test(k),
    );
    this.config.updateForTeam(tid, body);
    void this.audit
      .record({
        team_id: tid,
        actor_user_id: user.id,
        actor_name: user.display_name || user.username,
        action: secretKeys.length
          ? "settings.secrets_update"
          : "settings.update",
        resource_type: "settings",
        resource_id: tid,
        summary: `更新团队设置（${keys.length} 字段）`,
        detail: {
          keys,
          secret_keys: secretKeys,
        },
      })
      .catch(() => undefined);
    return this.config.getPublic(tid);
  }
}
