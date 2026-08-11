import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import type { DifyConfig, TeamSecrets } from "@agent-studio/agent-schema";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { TeamsService } from "../teams/teams.service";
import { DifyClientService } from "./dify-client.service";
import { DifyConfigService } from "./dify-config.service";

/**
 * Dify settings are team-scoped overlays under data/team-secrets/{teamId}.yaml.
 * Empty fields fall back to install-level dify-config / dify-secrets / DIFY_* env.
 */
@Controller("dify")
export class DifyController {
  constructor(
    @Inject(DifyConfigService) private readonly config: DifyConfigService,
    @Inject(DifyClientService) private readonly client: DifyClientService,
    @Inject(TeamsService) private readonly teams: TeamsService,
  ) {}

  private requireTeamId(team_id?: string) {
    const tid = (team_id || "").trim();
    if (!tid) throw new BadRequestException("team_id query is required");
    return tid;
  }

  @Get("config")
  async getConfig(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id?: string,
  ) {
    const tid = this.requireTeamId(team_id);
    await this.teams.requireMember(tid, user.id);
    return this.config.getPublicForTeam(tid);
  }

  @Put("config")
  async updateConfig(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id: string | undefined,
    @Body() body: Partial<DifyConfig> & Partial<TeamSecrets>,
  ) {
    const tid = this.requireTeamId(team_id);
    await this.teams.requireWritableMember(tid, user.id);
    return this.config.updateForTeam(tid, body);
  }

  /**
   * Exchange Console email/password for access_token and persist it on the team.
   * Password is never written to disk.
   */
  @Post("console/login")
  async consoleLogin(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id: string | undefined,
    @Body()
    body: {
      email?: string;
      password?: string;
      console_base?: string;
    },
  ) {
    const tid = this.requireTeamId(team_id);
    await this.teams.requireWritableMember(tid, user.id);
    return this.client.loginConsole({
      email: body.email || "",
      password: body.password || "",
      console_base: body.console_base,
      team_id: tid,
    });
  }

  @Get("health")
  async health(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id?: string,
  ) {
    const tid = this.requireTeamId(team_id);
    await this.teams.requireMember(tid, user.id);
    const pub = this.config.getPublicForTeam(tid);
    if (!pub.enabled || !pub.api_key_set) {
      return { ok: false, ...pub, error: "not configured" };
    }
    try {
      const auth = this.config.resolveAuthForTeam(tid);
      const parameters = await this.client.getParameters(auth);
      return { ok: true, ...pub, parameters, auth_source: auth.source };
    } catch (err) {
      return {
        ok: false,
        ...pub,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
