import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import type {
  DigitalHumanCreate,
  DigitalHumanUpdate,
} from "@agent-studio/agent-schema";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { DigitalHumansService } from "./digital-humans.service";

@Controller()
export class DigitalHumansController {
  constructor(
    @Inject(DigitalHumansService) private readonly humans: DigitalHumansService,
  ) {}

  @Get("digital-humans")
  async list(
    @CurrentUser() user: RequestUser,
    @Query("enabled") enabled?: "true" | "false" | "all",
    @Query("role") role?: string,
    @Query("q") q?: string,
    @Query("team_id") team_id?: string,
  ) {
    const items = await this.humans.listForUser(user.id, {
      enabled,
      role,
      q,
      team_id,
    });
    return { items, total: items.length };
  }

  @Get("digital-humans/:id")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.humans.getForUser(user.id, id);
  }

  @Post("digital-humans")
  create(@CurrentUser() user: RequestUser, @Body() body: DigitalHumanCreate) {
    return this.humans.createForUser(user.id, body);
  }

  @Put("digital-humans/:id")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: DigitalHumanUpdate,
  ) {
    return this.humans.updateForUser(user.id, id, body);
  }

  @Patch("digital-humans/:id/enabled")
  setEnabled(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.humans.setEnabledForUser(user.id, id, Boolean(body?.enabled));
  }

  @Delete("digital-humans/:id")
  remove(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.humans.removeForUser(user.id, id);
  }

  @Post("seed/defaults")
  seed(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id?: string,
  ) {
    return this.humans.seedDefaultsForUser(user.id, team_id || "");
  }
}
