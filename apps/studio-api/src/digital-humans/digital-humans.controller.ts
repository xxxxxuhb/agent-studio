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
import { DigitalHumansService } from "./digital-humans.service";

@Controller()
export class DigitalHumansController {
  constructor(
    @Inject(DigitalHumansService) private readonly humans: DigitalHumansService,
  ) {}

  @Get("digital-humans")
  list(
    @Query("enabled") enabled?: "true" | "false" | "all",
    @Query("role") role?: string,
    @Query("q") q?: string,
  ) {
    const items = this.humans.list({ enabled, role, q });
    return { items, total: items.length };
  }

  @Get("digital-humans/:id")
  get(@Param("id") id: string) {
    return this.humans.get(id);
  }

  @Post("digital-humans")
  create(@Body() body: DigitalHumanCreate) {
    return this.humans.create(body);
  }

  @Put("digital-humans/:id")
  update(@Param("id") id: string, @Body() body: DigitalHumanUpdate) {
    return this.humans.update(id, body);
  }

  @Patch("digital-humans/:id/enabled")
  setEnabled(@Param("id") id: string, @Body() body: { enabled: boolean }) {
    return this.humans.setEnabled(id, Boolean(body?.enabled));
  }

  @Delete("digital-humans/:id")
  remove(@Param("id") id: string) {
    return this.humans.remove(id);
  }

  @Post("seed/defaults")
  seed() {
    return this.humans.seedDefaults();
  }
}
