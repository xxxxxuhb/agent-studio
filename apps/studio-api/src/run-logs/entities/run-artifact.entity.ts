import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

/**
 * Persisted Bridge run artifact bodies (survive Bridge disk GC).
 * Keyed by studio run_id + basename (same as Bridge artifacts API).
 */
@Entity("run_artifacts")
export class RunArtifactEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  studio_run_id!: string;

  @PrimaryColumn({ type: "varchar", length: 256 })
  name!: string;

  @Column({ type: "varchar", length: 512, default: "" })
  rel_path!: string;

  @Index()
  @Column({ type: "varchar", length: 64, default: "" })
  work_order_id!: string;

  @Index()
  @Column({ type: "varchar", length: 36, default: "" })
  team_id!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  step_id!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  role!: string;

  @Column({ type: "varchar", length: 128, default: "text/plain; charset=utf-8" })
  content_type!: string;

  @Column({ type: "int", default: 0 })
  bytes!: number;

  @Column({ type: "mediumtext" })
  content!: string;

  @Column({ type: "varchar", length: 40 })
  captured_at!: string;
}
