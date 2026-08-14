import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { PipelineTriggersService } from "./pipeline-triggers.service";

@Controller("webhooks")
export class TriggersController {
  constructor(private readonly triggers: PipelineTriggersService) {}

  /**
   * Forge inbound webhook → match pipeline triggers → create+start work order.
   * Auth: X-Gitlab-Token / X-Studio-Webhook-Token / X-Hub-Signature-256
   * (secret from trigger.secret, team forge_webhook_secret, or STUDIO_FORGE_WEBHOOK_SECRET).
   */
  @Public()
  @Post("pipelines/:pipelineId/forge")
  async forge(
    @Param("pipelineId") pipelineId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { rawBody?: Buffer; body?: unknown },
    @Body() body: unknown,
  ) {
    const rawBody =
      req.rawBody ||
      Buffer.from(JSON.stringify(body ?? {}), "utf8");
    return this.triggers.handleForgeWebhook({
      pipelineId,
      headers,
      rawBody,
      body: body ?? req.body,
    });
  }

  /** Manual cron tick (ops / tests). Protected by STUDIO_FORGE_WEBHOOK_SECRET. */
  @Public()
  @Post("triggers/cron-tick")
  async cronTick(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const token =
      String(headers["x-studio-webhook-token"] || "").trim() ||
      String(headers["x-studio-cron-token"] || "").trim();
    const expected = (process.env.STUDIO_FORGE_WEBHOOK_SECRET || "").trim();
    if (!expected || token !== expected) {
      return { ok: false, error: "unauthorized" };
    }
    const fired = await this.triggers.tickCron();
    return { ok: true, fired };
  }
}
