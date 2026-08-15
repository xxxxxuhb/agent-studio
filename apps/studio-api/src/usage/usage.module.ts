import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TeamsModule } from "../teams/teams.module";
import { UsageEventEntity } from "./entities/usage-event.entity";
import { UsageController } from "./usage.controller";
import { UsageService } from "./usage.service";

@Module({
  imports: [TypeOrmModule.forFeature([UsageEventEntity]), TeamsModule],
  controllers: [UsageController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
