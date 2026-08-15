import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserEntity } from "../auth/entities/user.entity";
import { BridgeEntity } from "../bridges/entities/bridge.entity";
import { DigitalHumanEntity } from "../digital-humans/entities/digital-human.entity";
import { PipelineEntity } from "../pipelines/entities/pipeline.entity";
import { ProjectEntity } from "../projects/entities/project.entity";
import { RunLogEntryEntity } from "../run-logs/entities/run-log-entry.entity";
import { RunLogMetaEntity } from "../run-logs/entities/run-log-meta.entity";
import { RunArtifactEntity } from "../run-logs/entities/run-artifact.entity";
import { UsageEventEntity } from "../usage/entities/usage-event.entity";
import { AuditLogEntity } from "../audit/entities/audit-log.entity";
import { NotificationEntity } from "../notifications/entities/notification.entity";
import { TeamEntity } from "../teams/entities/team.entity";
import { TeamMemberEntity } from "../teams/entities/team-member.entity";
import { WorkOrderEntity } from "../work-orders/entities/work-order.entity";
import { StudioJobEntity } from "../work-orders/entities/studio-job.entity";
import { WorkOrderAttachmentEntity } from "../work-orders/entities/work-order-attachment.entity";

function mysqlConfig() {
  const host = process.env.STUDIO_MYSQL_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.STUDIO_MYSQL_PORT || 3306);
  const username = process.env.STUDIO_MYSQL_USER?.trim() || "root";
  const password = process.env.STUDIO_MYSQL_PASSWORD ?? "";
  const database = process.env.STUDIO_MYSQL_DATABASE?.trim() || "agent_studio";
  return { host, port, username, password, database };
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "mysql",
      ...mysqlConfig(),
      entities: [
        UserEntity,
        TeamEntity,
        TeamMemberEntity,
        ProjectEntity,
        WorkOrderEntity,
        StudioJobEntity,
        WorkOrderAttachmentEntity,
        RunLogMetaEntity,
        RunLogEntryEntity,
        RunArtifactEntity,
        UsageEventEntity,
        AuditLogEntity,
        NotificationEntity,
        DigitalHumanEntity,
        PipelineEntity,
        BridgeEntity,
      ],
      synchronize: process.env.STUDIO_MYSQL_SYNC === "true",
      logging: process.env.STUDIO_MYSQL_LOGGING === "true",
    }),
  ],
})
export class DatabaseModule {}
