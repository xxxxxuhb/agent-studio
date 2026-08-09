import { Body, Controller, Get, Inject, Put } from "@nestjs/common";
import type { StudioConfig } from "@agent-studio/agent-schema";
import { StudioConfigService } from "./studio-config.service";

@Controller("settings")
export class StudioConfigController {
  constructor(
    @Inject(StudioConfigService) private readonly config: StudioConfigService,
  ) {}

  @Get()
  get() {
    return this.config.get();
  }

  @Put()
  update(@Body() body: Partial<StudioConfig>) {
    return this.config.update(body);
  }
}
