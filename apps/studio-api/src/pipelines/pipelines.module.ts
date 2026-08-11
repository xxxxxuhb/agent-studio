import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DigitalHumansModule } from "../digital-humans/digital-humans.module";
import { DifyModule } from "../dify/dify.module";
import { TeamsModule } from "../teams/teams.module";
import { PipelineEntity } from "./entities/pipeline.entity";
import { PipelinesController } from "./pipelines.controller";
import { PipelinesService } from "./pipelines.service";

@Module({
  imports: [
    DigitalHumansModule,
    DifyModule,
    TeamsModule,
    TypeOrmModule.forFeature([PipelineEntity]),
  ],
  controllers: [PipelinesController],
  providers: [PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
