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
import { BridgesService } from "./bridges.service";

@Controller("bridges")
export class BridgesController {
  constructor(@Inject(BridgesService) private readonly bridges: BridgesService) {}

  @Get()
  list(@Query("status") status?: string) {
    const items = this.bridges.list({ status });
    return {
      items,
      total: items.length,
      token_configured: this.bridges.tokenConfigured(),
    };
  }

  @Post("prepare")
  prepare(@Body() body: unknown) {
    return this.bridges.prepare(body);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.bridges.get(id);
  }

  @Post("register")
  register(@Body() body: unknown) {
    return this.bridges.register(body);
  }

  @Post(":id/heartbeat")
  heartbeat(@Param("id") id: string, @Body() body: unknown) {
    return this.bridges.heartbeat(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.bridges.remove(id);
  }
}
