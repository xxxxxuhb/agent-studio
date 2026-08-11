import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import type { WorkOrderRun } from "@agent-studio/agent-schema";

@Entity("work_orders")
export class WorkOrderEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 36 })
  team_id!: string;

  @Index()
  @Column({ type: "varchar", length: 64, default: "" })
  project_id!: string;

  @Column({ type: "varchar", length: 256 })
  title!: string;

  @Column({ type: "text" })
  requirement!: string;

  @Column({ type: "varchar", length: 32, default: "draft" })
  status!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  pipeline_id!: string;

  @Column({ type: "varchar", length: 32, default: "requirement" })
  category!: string;

  @Column({ type: "varchar", length: 16, default: "medium" })
  priority!: string;

  @Column({ type: "json" })
  tags!: string[];

  @Column({ type: "json" })
  clarifications!: Array<{ at: string; note: string }>;

  @Column({ type: "json", nullable: true })
  run!: WorkOrderRun | null;

  @CreateDateColumn({ type: "datetime" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime" })
  updated_at!: Date;
}
