import { Controller, Get, Inject } from "@nestjs/common";
import { DigitalHumansService } from "./digital-humans/digital-humans.service";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(DigitalHumansService) private readonly humans: DigitalHumansService,
  ) {}

  @Get()
  health() {
    return {
      ok: true,
      service: "studio-api",
      dataDir: this.humans.getDataDir(),
      count: this.humans.list().length,
    };
  }
}
