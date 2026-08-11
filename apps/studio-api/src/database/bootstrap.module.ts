import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { ProjectEntity } from "../projects/entities/project.entity";
import { RunLogsService } from "../run-logs/run-logs.service";
import { TeamEntity } from "../teams/entities/team.entity";
import { TeamMemberEntity } from "../teams/entities/team-member.entity";
import { WorkOrderEntity } from "../work-orders/entities/work-order.entity";
import { BootstrapService } from "./bootstrap.service";
import { DatabaseModule } from "./database.module";
import { RunLogsModule } from "../run-logs/run-logs.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    RunLogsModule,
    TypeOrmModule.forFeature([
      TeamEntity,
      TeamMemberEntity,
      ProjectEntity,
      WorkOrderEntity,
    ]),
  ],
  providers: [BootstrapService],
  exports: [BootstrapService],
})
export class BootstrapModule {}
