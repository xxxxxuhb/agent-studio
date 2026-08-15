import { Module } from "@nestjs/common";
import { TeamsModule } from "../teams/teams.module";
import { AuditModule } from "../audit/audit.module";
import { StudioConfigController } from "./studio-config.controller";
import { StudioConfigService } from "./studio-config.service";

@Module({
  imports: [TeamsModule, AuditModule],
  controllers: [StudioConfigController],
  providers: [StudioConfigService],
  exports: [StudioConfigService],
})
export class StudioConfigModule {}
