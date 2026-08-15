import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";
import type { RunLogSource } from "@agent-studio/agent-schema";

@Entity("run_logs")
export class RunLogMetaEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  run_id!: string;

  @Index()
  @Column({ type: "varchar", length: 64 })
  work_order_id!: string;

  @Index()
  @Column({ type: "varchar", length: 36, default: "" })
  team_id!: string;

  @Column({ type: "varchar", length: 256, default: "" })
  title!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  pipeline_id!: string;

  @Column({ type: "varchar", length: 256, default: "" })
  pipeline_name!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  executor!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  project_id!: string;

  @Column({ type: "varchar", length: 32, default: "" })
  work_order_status!: string;

  @Index()
  @Column({ type: "varchar", length: 64, default: "" })
  bridge_run_id!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  bridge_stage!: string;

  @Column({ type: "text", default: "" })
  last_error!: string;

  @Column({ type: "varchar", length: 40 })
  started_at!: string;

  @Column({ type: "varchar", length: 40 })
  updated_at!: string;

  @Column({ type: "int", default: 0 })
  entry_count!: number;

  @Column({ type: "json" })
  sources!: RunLogSource[];
}
