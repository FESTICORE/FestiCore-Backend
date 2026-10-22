import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AdminRole } from './admin-roles.decorator';

@Entity('admin_accounts')
@Index('IDX_admin_accounts_email', ['email'], { unique: true })
@Index('IDX_admin_accounts_user_id', ['userId'], { unique: true })
export class AdminAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  email!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar' })
  role!: AdminRole;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('admin_auth_audit')
export class AdminAuthAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  adminId!: string | null;

  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'varchar', nullable: true })
  ipAddress!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
