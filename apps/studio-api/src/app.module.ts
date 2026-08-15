import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { AuthModule } from "./auth/auth.module";
import { BootstrapModule } from "./database/bootstrap.module";
import { DatabaseModule } from "./database/database.module";
import { BridgesModule } from "./bridges/bridges.module";
import { DigitalHumansModule } from "./digital-humans/digital-humans.module";
import { PipelinesModule } from "./pipelines/pipelines.module";
import { ProjectsModule } from "./projects/projects.module";
import { RunLogsModule } from "./run-logs/run-logs.module";
import { StudioConfigModule } from "./studio-config/studio-config.module";
import { TeamsModule } from "./teams/teams.module";
import { WorkOrdersModule } from "./work-orders/work-orders.module";
import { TriggersModule } from "./triggers/triggers.module";
import { UsageModule } from "./usage/usage.module";
import { AuditModule } from "./audit/audit.module";
import { NotificationsModule } from "./notifications/notifications.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    BootstrapModule,
    TeamsModule,
    DigitalHumansModule,
    PipelinesModule,
    ProjectsModule,
    RunLogsModule,
    BridgesModule,
    WorkOrdersModule,
    StudioConfigModule,
    NotificationsModule,
    TriggersModule,
    UsageModule,
    AuditModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
