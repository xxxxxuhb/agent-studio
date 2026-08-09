import { Module } from "@nestjs/common";
import { DifyClientService } from "./dify-client.service";
import { DifyConfigService } from "./dify-config.service";
import { DifyController } from "./dify.controller";

@Module({
  controllers: [DifyController],
  providers: [DifyConfigService, DifyClientService],
  exports: [DifyConfigService, DifyClientService],
})
export class DifyModule {}
