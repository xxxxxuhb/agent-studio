import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { BridgesService } from "./bridges.service";

@Controller("bridges")
export class BridgesController {
  constructor(@Inject(BridgesService) private readonly bridges: BridgesService) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query("status") status?: string,
    @Query("team_id") team_id?: string,
  ) {
    const items = await this.bridges.listForUser(user.id, { status, team_id });
    return {
      items,
      total: items.length,
      token_configured: this.bridges.tokenConfigured(),
    };
  }

  @Post("prepare")
  prepare(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    return this.bridges.prepareForUser(user.id, body);
  }

  @Get(":id")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.bridges.getForUser(user.id, id);
  }

  /** Machine auth — bridge token, not JWT. */
  @Public()
  @Post("register")
  register(@Body() body: unknown) {
    return this.bridges.register(body);
  }

  /** Machine auth — bridge token, not JWT. */
  @Public()
  @Post(":id/heartbeat")
  heartbeat(@Param("id") id: string, @Body() body: unknown) {
    return this.bridges.heartbeat(id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.bridges.removeForUser(user.id, id);
  }
}
