import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TeamsModule } from "../teams/teams.module";
import { DigitalHumansController } from "./digital-humans.controller";
import { DigitalHumansService } from "./digital-humans.service";
import { DigitalHumanEntity } from "./entities/digital-human.entity";

@Module({
  imports: [TeamsModule, TypeOrmModule.forFeature([DigitalHumanEntity])],
  controllers: [DigitalHumansController],
  providers: [DigitalHumansService],
  exports: [DigitalHumansService],
})
export class DigitalHumansModule {}
