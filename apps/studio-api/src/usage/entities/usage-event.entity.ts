import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

@Entity("usage_events")
export class UsageEventEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 40 })
  at!: string;

  @Index()
  @Column({ type: "varchar", length: 36, default: "" })
  team_id!: string;

  @Index()
  @Column({ type: "varchar", length: 64, default: "" })
  work_order_id!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  run_id!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  bridge_run_id!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  step_id!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  stage!: string;

  @Index()
  @Column({ type: "varchar", length: 64, default: "" })
  driver!: string;

  @Column({ type: "int", nullable: true })
  prompt_tokens!: number | null;

  @Column({ type: "int", nullable: true })
  completion_tokens!: number | null;

  @Column({ type: "int", nullable: true })
  total_tokens!: number | null;

  @Column({ type: "decimal", precision: 12, scale: 6, nullable: true })
  cost_usd!: string | null;

  @Column({ type: "tinyint", default: 0 })
  dry_run!: number;

  @Column({ type: "json", nullable: true })
  detail!: Record<string, unknown> | null;
}
