import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BridgesModule } from "../bridges/bridges.module";
import { DigitalHumansModule } from "../digital-humans/digital-humans.module";
import { DifyModule } from "../dify/dify.module";
import { PipelinesModule } from "../pipelines/pipelines.module";
import { ProjectsModule } from "../projects/projects.module";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RealtimeModule } from "../realtime/realtime.module";
import { RunLogsModule } from "../run-logs/run-logs.module";
import { StudioConfigModule } from "../studio-config/studio-config.module";
import { TeamsModule } from "../teams/teams.module";
import { WorkOrderEntity } from "./entities/work-order.entity";
import { ManagerChatService } from "./manager-chat.service";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrdersService } from "./work-orders.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkOrderEntity]),
    TeamsModule,
    PipelinesModule,
    DigitalHumansModule,
    DifyModule,
    StudioConfigModule,
    ProjectsModule,
    RunLogsModule,
    RealtimeModule,
    BridgesModule,
  ],
  controllers: [WorkOrdersController],
  providers: [
    WorkOrdersService,
    ManagerChatService,
    RealtimeGateway,
  ],
  exports: [WorkOrdersService, ManagerChatService],
})
export class WorkOrdersModule {}
