import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('apple_revoke_retries')
export class AppleRevokeRetry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_apple_revoke_retries_token_hash', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ type: 'varchar' })
  clientId!: string;

  @Column({ type: 'text' })
  ciphertext!: string;

  @Column({ type: 'varchar', length: 24 })
  iv!: string;

  @Column({ type: 'varchar', length: 24 })
  authTag!: string;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Index('IDX_apple_revoke_retries_due')
  @Column({ type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  exhaustedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
