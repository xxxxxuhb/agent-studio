import { Module } from "@nestjs/common";
import { BridgesModule } from "../bridges/bridges.module";
import { ProjectsModule } from "../projects/projects.module";
import { StudioConfigModule } from "../studio-config/studio-config.module";
import { WorkOrdersModule } from "../work-orders/work-orders.module";
import { WorkspaceBrowseService } from "./workspace-browse.service";
import { WorkspaceController } from "./workspace.controller";

@Module({
  imports: [
    WorkOrdersModule,
    ProjectsModule,
    BridgesModule,
    StudioConfigModule,
  ],
  controllers: [WorkspaceController],
  providers: [WorkspaceBrowseService],
})
export class WorkspaceModule {}
