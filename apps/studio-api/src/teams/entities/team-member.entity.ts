import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

@Entity("team_members")
@Unique(["team_id", "user_id"])
export class TeamMemberEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: "varchar", length: 36 })
  team_id!: string;

  @Index()
  @Column({ type: "varchar", length: 36 })
  user_id!: string;

  @Column({ type: "varchar", length: 16 })
  role!: "owner" | "member" | "viewer";

  @CreateDateColumn({ type: "datetime" })
  created_at!: Date;
}
