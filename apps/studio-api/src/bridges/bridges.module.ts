import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RealtimeModule } from "../realtime/realtime.module";
import { TeamsModule } from "../teams/teams.module";
import { BridgesController } from "./bridges.controller";
import { BridgesGateway } from "./bridges.gateway";
import { BridgesService } from "./bridges.service";
import { BridgeEntity } from "./entities/bridge.entity";

@Module({
  imports: [
    RealtimeModule,
    TeamsModule,
    TypeOrmModule.forFeature([BridgeEntity]),
  ],
  controllers: [BridgesController],
  providers: [BridgesService, BridgesGateway],
  exports: [BridgesService],
})
export class BridgesModule {}
