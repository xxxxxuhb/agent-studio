import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("users")
export class UserEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 64 })
  username!: string;

  @Column({ type: "varchar", length: 255 })
  password_hash!: string;

  @Column({ type: "varchar", length: 128, default: "" })
  display_name!: string;

  @Column({ type: "boolean", default: false })
  is_admin!: boolean;

  @CreateDateColumn({ type: "datetime" })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime" })
  updated_at!: Date;
}
