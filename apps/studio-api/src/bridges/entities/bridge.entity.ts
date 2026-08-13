import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("bridges")
export class BridgeEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 36, default: "" })
  team_id!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "varchar", length: 512 })
  base_url!: string;

  @Column({ type: "varchar", length: 64, default: "auto" })
  driver!: string;

  @Column({ type: "varchar", length: 128, default: "" })
  driver_label!: string;

  @Column({ type: "boolean", default: false })
  dry_run!: boolean;

  @Column({ type: "varchar", length: 128, default: "" })
  model!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  platform!: string;

  /** cli | desktop — how the executor process is launched */
  @Column({ type: "varchar", length: 16, default: "cli" })
  link_type!: string;

  @Column({ type: "json" })
  available_drivers!: string[];

  @Column({ type: "varchar", length: 16, default: "offline" })
  status!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  current_run_id!: string;

  @Column({ type: "varchar", length: 40, default: "" })
  last_seen_at!: string;

  @Column({ type: "text" })
  note!: string;

  @CreateDateColumn({ type: "datetime" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime" })
  updated_at!: Date;
}
