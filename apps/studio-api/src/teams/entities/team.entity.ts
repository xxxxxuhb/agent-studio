import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("teams")
export class TeamEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 64 })
  slug!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @CreateDateColumn({ type: "datetime" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime" })
  updated_at!: Date;
}
