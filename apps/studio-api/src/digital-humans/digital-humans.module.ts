import { Module } from "@nestjs/common";
import { DigitalHumansController } from "./digital-humans.controller";
import { DigitalHumansService } from "./digital-humans.service";

@Module({
  controllers: [DigitalHumansController],
  providers: [DigitalHumansService],
  exports: [DigitalHumansService],
})
export class DigitalHumansModule {}
