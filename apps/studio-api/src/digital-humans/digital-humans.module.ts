import { Module } from "@nestjs/common";
import { TeamsModule } from "../teams/teams.module";
import { DigitalHumansController } from "./digital-humans.controller";
import { DigitalHumansService } from "./digital-humans.service";

@Module({
  imports: [TeamsModule],
  controllers: [DigitalHumansController],
  providers: [DigitalHumansService],
  exports: [DigitalHumansService],
})
export class DigitalHumansModule {}
