import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

@Entity("run_log_entries")
export class RunLogEntryEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  run_id!: string;

  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 64 })
  work_order_id!: string;

  @Column({ type: "varchar", length: 40 })
  at!: string;

  @Column({ type: "varchar", length: 16 })
  source!: string;

  @Column({ type: "varchar", length: 16, default: "info" })
  level!: string;

  @Column({ type: "text" })
  message!: string;

  @Column({ type: "mediumtext" })
  body!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  step_id!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  agent!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  bridge_stage!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  event_type!: string;

  @Column({ type: "json", nullable: true })
  detail!: Record<string, unknown> | null;
}
