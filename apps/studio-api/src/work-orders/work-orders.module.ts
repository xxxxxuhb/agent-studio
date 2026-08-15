import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BridgesModule } from "../bridges/bridges.module";
import { DigitalHumansModule } from "../digital-humans/digital-humans.module";
import { PipelinesModule } from "../pipelines/pipelines.module";
import { ProjectsModule } from "../projects/projects.module";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RealtimeModule } from "../realtime/realtime.module";
import { RunLogsModule } from "../run-logs/run-logs.module";
import { UsageModule } from "../usage/usage.module";
import { AuditModule } from "../audit/audit.module";
import { StudioConfigModule } from "../studio-config/studio-config.module";
import { TeamsModule } from "../teams/teams.module";
import { WorkOrderEntity } from "./entities/work-order.entity";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrdersService } from "./work-orders.service";
import { WorkOrderStudioRunner } from "./work-order-studio-runner.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkOrderEntity]),
    TeamsModule,
    PipelinesModule,
    DigitalHumansModule,
    StudioConfigModule,
    ProjectsModule,
    RunLogsModule,
    UsageModule,
    AuditModule,
    RealtimeModule,
    BridgesModule,
  ],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService, WorkOrderStudioRunner, RealtimeGateway],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
