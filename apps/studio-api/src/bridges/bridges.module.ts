import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { TeamsModule } from "../teams/teams.module";
import { BridgesController } from "./bridges.controller";
import { BridgesGateway } from "./bridges.gateway";
import { BridgesService } from "./bridges.service";

@Module({
  imports: [RealtimeModule, TeamsModule],
  controllers: [BridgesController],
  providers: [BridgesService, BridgesGateway],
  exports: [BridgesService],
})
export class BridgesModule {}
