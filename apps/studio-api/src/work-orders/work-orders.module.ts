import { Module } from "@nestjs/common";
import { BridgesModule } from "../bridges/bridges.module";
import { DigitalHumansModule } from "../digital-humans/digital-humans.module";
import { DifyModule } from "../dify/dify.module";
import { PipelinesModule } from "../pipelines/pipelines.module";
import { ProjectsModule } from "../projects/projects.module";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RealtimeModule } from "../realtime/realtime.module";
import { RunLogsModule } from "../run-logs/run-logs.module";
import { StudioConfigModule } from "../studio-config/studio-config.module";
import { ManagerChatService } from "./manager-chat.service";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrdersService } from "./work-orders.service";

@Module({
  imports: [
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
