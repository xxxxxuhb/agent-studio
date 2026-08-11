import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { BridgeEntity } from "../bridges/entities/bridge.entity";
import { DigitalHumanEntity } from "../digital-humans/entities/digital-human.entity";
import { PipelineEntity } from "../pipelines/entities/pipeline.entity";
import { ProjectEntity } from "../projects/entities/project.entity";
import { RunLogsModule } from "../run-logs/run-logs.module";
import { TeamEntity } from "../teams/entities/team.entity";
import { TeamMemberEntity } from "../teams/entities/team-member.entity";
import { WorkOrderEntity } from "../work-orders/entities/work-order.entity";
import { BootstrapService } from "./bootstrap.service";
import { DatabaseModule } from "./database.module";

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
      DigitalHumanEntity,
      PipelineEntity,
      BridgeEntity,
    ]),
  ],
  providers: [BootstrapService],
  exports: [BootstrapService],
})
export class BootstrapModule {}
