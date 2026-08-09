import { Module } from "@nestjs/common";
import { RealtimeHub } from "./realtime.hub";

@Module({
  providers: [RealtimeHub],
  exports: [RealtimeHub],
})
export class RealtimeModule {}
