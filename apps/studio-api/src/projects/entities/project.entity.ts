import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import type { ProjectRepo } from "@agent-studio/agent-schema";

@Entity("projects")
export class ProjectEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 36 })
  team_id!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "varchar", length: 512, default: "" })
  clone_root!: string;

  @Column({ type: "json" })
  repos!: ProjectRepo[];

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "json" })
  tags!: string[];

  @CreateDateColumn({ type: "datetime" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime" })
  updated_at!: Date;
}
