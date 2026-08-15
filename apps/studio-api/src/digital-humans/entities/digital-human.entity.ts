import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("digital_humans")
export class DigitalHumanEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 36 })
  team_id!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "varchar", length: 64 })
  role!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "json" })
  responsibilities!: string[];

  @Column({ type: "json" })
  permissions!: Record<string, unknown>;

  @Column({ type: "json" })
  inputs!: unknown[];

  @Column({ type: "json" })
  outputs!: unknown[];

  @Column({ type: "json" })
  commands!: string[];

  @Column({ type: "boolean", default: true })
  human_gate_default!: boolean;

  @Column({ type: "json" })
  prompt_hints!: string[];

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "varchar", length: 64, default: "" })
  avatar_label!: string;

  @Column({ type: "json" })
  tags!: string[];

  @Column({ type: "json" })
  bridge!: Record<string, unknown>;

  @CreateDateColumn({ type: "datetime" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime" })
  updated_at!: Date;
}
