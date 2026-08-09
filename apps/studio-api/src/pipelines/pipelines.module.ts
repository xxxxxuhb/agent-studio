import { Module } from "@nestjs/common";
import { DigitalHumansModule } from "../digital-humans/digital-humans.module";
import { DifyModule } from "../dify/dify.module";
import { PipelinesController } from "./pipelines.controller";
import { PipelinesService } from "./pipelines.service";

@Module({
  imports: [DigitalHumansModule, DifyModule],
  controllers: [PipelinesController],
  providers: [PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
