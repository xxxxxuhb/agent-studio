import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("studio_jobs")
export class StudioJobEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 64 })
  work_order_id!: string;

  @Index()
  @Column({ type: "varchar", length: 64 })
  run_id!: string;

  @Column({ type: "varchar", length: 32 })
  kind!: string;

  @Column({ type: "json" })
  payload!: Record<string, unknown>;

  @Index()
  @Column({ type: "varchar", length: 16, default: "pending" })
  status!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  claimed_by!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  claimed_at!: string | null;

  @Column({ type: "varchar", length: 40, nullable: true })
  finished_at!: string | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @Index()
  @Column({ type: "varchar", length: 40 })
  created_at!: string;
}
