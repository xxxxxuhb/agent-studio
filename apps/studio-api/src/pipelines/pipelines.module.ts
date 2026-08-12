import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DigitalHumansModule } from "../digital-humans/digital-humans.module";
import { StudioConfigModule } from "../studio-config/studio-config.module";
import { TeamsModule } from "../teams/teams.module";
import { PipelineEntity } from "./entities/pipeline.entity";
import { PipelinesController } from "./pipelines.controller";
import { PipelinesService } from "./pipelines.service";

@Module({
  imports: [
    DigitalHumansModule,
    StudioConfigModule,
    TeamsModule,
    TypeOrmModule.forFeature([PipelineEntity]),
  ],
  controllers: [PipelinesController],
  providers: [PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
