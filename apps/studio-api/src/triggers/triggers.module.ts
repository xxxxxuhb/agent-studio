import { Module, forwardRef } from "@nestjs/common";
import { PipelinesModule } from "../pipelines/pipelines.module";
import { StudioConfigModule } from "../studio-config/studio-config.module";
import { WorkOrdersModule } from "../work-orders/work-orders.module";
import { PipelineTriggersService } from "./pipeline-triggers.service";
import { TriggersController } from "./triggers.controller";

@Module({
  imports: [
    PipelinesModule,
    StudioConfigModule,
    forwardRef(() => WorkOrdersModule),
  ],
  controllers: [TriggersController],
  providers: [PipelineTriggersService],
  exports: [PipelineTriggersService],
})
export class TriggersModule {}
