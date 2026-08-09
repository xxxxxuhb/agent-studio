import { Module } from "@nestjs/common";
import { StudioConfigController } from "./studio-config.controller";
import { StudioConfigService } from "./studio-config.service";

@Module({
  controllers: [StudioConfigController],
  providers: [StudioConfigService],
  exports: [StudioConfigService],
})
export class StudioConfigModule {}
