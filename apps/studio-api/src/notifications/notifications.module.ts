import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RealtimeModule } from "../realtime/realtime.module";
import { StudioConfigModule } from "../studio-config/studio-config.module";
import { TeamsModule } from "../teams/teams.module";
import { NotificationEntity } from "./entities/notification.entity";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationEntity]),
    StudioConfigModule,
    TeamsModule,
    RealtimeModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
