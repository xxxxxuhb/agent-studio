import { Module } from "@nestjs/common";
import { TeamsModule } from "../teams/teams.module";
import { StudioConfigController } from "./studio-config.controller";
import { StudioConfigService } from "./studio-config.service";

@Module({
  imports: [TeamsModule],
  controllers: [StudioConfigController],
  providers: [StudioConfigService],
  exports: [StudioConfigService],
})
export class StudioConfigModule {}
