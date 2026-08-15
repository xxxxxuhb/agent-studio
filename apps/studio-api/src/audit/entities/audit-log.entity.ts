import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

@Entity("audit_logs")
export class AuditLogEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 40 })
  at!: string;

  @Index()
  @Column({ type: "varchar", length: 36, default: "" })
  team_id!: string;

  @Index()
  @Column({ type: "varchar", length: 36, default: "" })
  actor_user_id!: string;

  @Column({ type: "varchar", length: 128, default: "" })
  actor_name!: string;

  @Index()
  @Column({ type: "varchar", length: 64 })
  action!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  resource_type!: string;

  @Column({ type: "varchar", length: 128, default: "" })
  resource_id!: string;

  @Column({ type: "varchar", length: 512, default: "" })
  summary!: string;

  @Column({ type: "json", nullable: true })
  detail!: Record<string, unknown> | null;
}
