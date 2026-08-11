import { Module } from "@nestjs/common";
import { TeamsModule } from "../teams/teams.module";
import { DifyClientService } from "./dify-client.service";
import { DifyConfigService } from "./dify-config.service";
import { DifyController } from "./dify.controller";

@Module({
  imports: [TeamsModule],
  controllers: [DifyController],
  providers: [DifyConfigService, DifyClientService],
  exports: [DifyConfigService, DifyClientService],
})
export class DifyModule {}
