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
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkOrderEntity } from "./entities/work-order.entity";
import { StudioJobEntity } from "./entities/studio-job.entity";
import { WorkOrderAttachmentEntity } from "./entities/work-order-attachment.entity";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrdersService } from "./work-orders.service";
import { WorkOrderStudioRunner } from "./work-order-studio-runner.service";
import { StudioJobsService } from "./studio-jobs.service";
import { StudioJobWorkerService } from "./studio-job-worker.service";
import { WorkOrderAttachmentsService } from "./work-order-attachments.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkOrderEntity,
      StudioJobEntity,
      WorkOrderAttachmentEntity,
    ]),
    TeamsModule,
    PipelinesModule,
    DigitalHumansModule,
    StudioConfigModule,
    NotificationsModule,
    ProjectsModule,
    RunLogsModule,
    UsageModule,
    AuditModule,
    RealtimeModule,
    BridgesModule,
  ],
  controllers: [WorkOrdersController],
  providers: [
    WorkOrdersService,
    WorkOrderStudioRunner,
    StudioJobsService,
    StudioJobWorkerService,
    WorkOrderAttachmentsService,
    RealtimeGateway,
  ],
  exports: [WorkOrdersService, StudioJobsService, WorkOrderAttachmentsService],
})
export class WorkOrdersModule {}
