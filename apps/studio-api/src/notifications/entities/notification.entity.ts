import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("notifications")
export class NotificationEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 36 })
  team_id!: string;

  @Index()
  @Column({ type: "varchar", length: 36 })
  user_id!: string;

  @Column({ type: "varchar", length: 32 })
  kind!: string;

  @Column({ type: "varchar", length: 256, default: "" })
  title!: string;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  work_order_id!: string;

  @Column({ type: "varchar", length: 36, default: "" })
  actor_user_id!: string;

  @Column({ type: "varchar", length: 128, default: "" })
  actor_name!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  read_at!: string | null;

  @Index()
  @Column({ type: "varchar", length: 40 })
  created_at!: string;
}
