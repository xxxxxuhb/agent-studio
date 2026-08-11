import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TeamsModule } from "../teams/teams.module";
import { RunLogEntryEntity } from "./entities/run-log-entry.entity";
import { RunLogMetaEntity } from "./entities/run-log-meta.entity";
import { RunLogsController } from "./run-logs.controller";
import { RunLogsService } from "./run-logs.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([RunLogMetaEntity, RunLogEntryEntity]),
    TeamsModule,
  ],
  controllers: [RunLogsController],
  providers: [RunLogsService],
  exports: [RunLogsService],
})
export class RunLogsModule {}
