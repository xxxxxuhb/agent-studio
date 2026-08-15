import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("work_order_attachments")
export class WorkOrderAttachmentEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 36 })
  team_id!: string;

  @Index()
  @Column({ type: "varchar", length: 64 })
  work_order_id!: string;

  @Column({ type: "varchar", length: 256 })
  filename!: string;

  @Column({ type: "varchar", length: 128, default: "application/octet-stream" })
  content_type!: string;

  @Column({ type: "int", default: 0 })
  bytes!: number;

  @Column({ type: "mediumblob" })
  content!: Buffer;

  @Column({ type: "varchar", length: 36, default: "" })
  created_by!: string;

  @Column({ type: "varchar", length: 40 })
  created_at!: string;
}
