import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("pipelines")
export class PipelineEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 36 })
  team_id!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "json" })
  tags!: string[];

  @Column({ type: "json" })
  source!: Record<string, unknown>;

  @Column({ type: "json" })
  defaults!: Record<string, unknown>;

  @Column({ type: "json" })
  steps!: unknown[];

  @Column({ type: "json" })
  dify!: Record<string, unknown>;

  @CreateDateColumn({ type: "datetime" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime" })
  updated_at!: Date;
}
