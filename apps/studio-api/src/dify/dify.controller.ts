import { Body, Controller, Get, Inject, Post, Put } from "@nestjs/common";
import type { DifyConfig } from "@agent-studio/agent-schema";
import { DifyClientService } from "./dify-client.service";
import { DifyConfigService } from "./dify-config.service";

@Controller("dify")
export class DifyController {
  constructor(
    @Inject(DifyConfigService) private readonly config: DifyConfigService,
    @Inject(DifyClientService) private readonly client: DifyClientService,
  ) {}

  @Get("config")
  getConfig() {
    return this.config.getPublic();
  }

  @Put("config")
  updateConfig(@Body() body: Partial<DifyConfig>) {
    return this.config.update(body);
  }

  /**
   * Exchange Console email/password for access_token and persist it.
   * Password is never written to disk.
   */
  @Post("console/login")
  async consoleLogin(
    @Body()
    body: {
      email?: string;
      password?: string;
      console_base?: string;
    },
  ) {
    return this.client.loginConsole({
      email: body.email || "",
      password: body.password || "",
      console_base: body.console_base,
    });
  }

  @Get("health")
  async health() {
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
