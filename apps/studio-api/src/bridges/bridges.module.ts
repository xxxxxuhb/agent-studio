import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { BridgesController } from "./bridges.controller";
import { BridgesGateway } from "./bridges.gateway";
import { BridgesService } from "./bridges.service";

@Module({
  imports: [RealtimeModule],
  controllers: [BridgesController],
  providers: [BridgesService, BridgesGateway],
  exports: [BridgesService],
})
export class BridgesModule {}
