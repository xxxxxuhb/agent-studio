import { Controller, Get, Inject } from "@nestjs/common";
import { Public } from "./auth/public.decorator";
import { DigitalHumansService } from "./digital-humans/digital-humans.service";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(DigitalHumansService) private readonly humans: DigitalHumansService,
  ) {}

  @Public()
  @Get()
  async health() {
    const items = await this.humans.list();
    return {
      ok: true,
      service: "studio-api",
      storage: "mysql",
      digital_humans: items.length,
    };
  }
}
