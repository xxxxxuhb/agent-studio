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
import type { DifyConfig } from "@agent-studio/agent-schema";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { TeamsService } from "../teams/teams.service";
import { DifyClientService } from "./dify-client.service";
import { DifyConfigService } from "./dify-config.service";

/**
 * Dify install secrets remain global (not yet split per team).
 * Endpoints are gated by team membership so only members of the selected
 * team can view/edit the shared install-scoped config.
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
    return this.config.getPublic();
  }

  @Put("config")
  async updateConfig(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id: string | undefined,
    @Body() body: Partial<DifyConfig>,
  ) {
    const tid = this.requireTeamId(team_id);
    await this.teams.requireWritableMember(tid, user.id);
    return this.config.update(body);
  }

  /**
   * Exchange Console email/password for access_token and persist it.
   * Password is never written to disk.
   * Secrets remain install-scoped (not per-team yet).
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
    });
  }

  @Get("health")
  async health(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id?: string,
  ) {
    const tid = this.requireTeamId(team_id);
    await this.teams.requireMember(tid, user.id);
    const pub = this.config.getPublic();
    if (!pub.enabled || !pub.api_key_set) {
      return { ok: false, ...pub, error: "not configured" };
    }
    try {
      const parameters = await this.client.getParameters();
      return { ok: true, ...pub, parameters };
    } catch (err) {
      return {
        ok: false,
        ...pub,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
