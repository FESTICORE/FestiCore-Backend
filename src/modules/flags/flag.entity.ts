import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type FlagLifecycle = 'scheduled' | 'active' | 'resting' | 'ended';
export type FlagActivity = 'slam' | 'sing' | 'train' | 'calm' | 'resting';

@Entity('flags')
@Index('IDX_flags_festival_name', ['festivalId', 'name'], { unique: true })
export class Flag {
  @PrimaryColumn({ type: 'varchar', length: 32 }) id!: string;
  @Column({ type: 'varchar', length: 32 }) festivalId!: string;
  @Column({ type: 'varchar', length: 20 }) name!: string;
  @Column({ type: 'varchar', length: 20, default: 'public' }) visibility!:
    'public' | 'private';
  @Column({ type: 'varchar', nullable: true }) thumbUrl!: string | null;
  @Column({ type: 'varchar', nullable: true }) photoUrl!: string | null;
  @Column({ type: 'varchar', nullable: true }) photoKey!: string | null;
  @Column({ type: 'varchar', nullable: true }) thumbKey!: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) tags!: string[];
  @Column({ type: 'varchar', length: 60, nullable: true }) bio!: string | null;
  @Column({ type: 'integer', default: 0 }) followerCount!: number;
  @Column({ type: 'boolean', default: true }) planVisible!: boolean;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) plan!: string[];
  @Column({ type: 'varchar', length: 32, nullable: true }) homeZoneId!:
    string | null;
  @Column({ type: 'varchar', length: 32, nullable: true }) zoneId!:
    string | null;
  @Column({ type: 'varchar', length: 20, default: 'scheduled' })
  status!: FlagLifecycle;
  @Column({ type: 'varchar', length: 20, nullable: true })
  activity!: FlagActivity | null;
  @Column({ type: 'boolean', default: false }) hidden!: boolean;
  @Column({ type: 'integer', default: 0 }) reportCount!: number;
  @Column({ type: 'varchar', length: 36, nullable: true }) ownerId!:
    string | null;
  @Column({ type: 'date', nullable: true }) restartDate!: string | null;
  @Column({ type: 'timestamptz', nullable: true })
  statusUpdatedAt!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

@Entity('flag_follows')
@Index('IDX_flag_follows_user_flag', ['userId', 'flagId'], { unique: true })
export class FlagFollow {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar', length: 32 }) flagId!: string;
  @Column({ type: 'varchar', length: 32 }) festivalId!: string;
  @CreateDateColumn({ type: 'timestamptz' }) followedAt!: Date;
}

@Entity('flag_pins')
export class FlagPin {
  @PrimaryColumn({ type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar', length: 32, nullable: true }) flagId!:
    string | null;
}

@Entity('flag_bearers')
@Index('IDX_flag_bearers_flag_user', ['flagId', 'userId'], { unique: true })
@Index('IDX_flag_bearers_user_festival', ['userId', 'festivalId'], {
  unique: true,
})
export class FlagBearer {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 32 }) flagId!: string;
  @Column({ type: 'varchar', length: 32 }) festivalId!: string;
  @Column({ type: 'uuid' }) userId!: string;
  @Column({ type: 'boolean', default: false }) isOwner!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity('flag_bearer_codes')
export class FlagBearerCode {
  @PrimaryColumn({ type: 'varchar', length: 64 }) codeHash!: string;
  @Column({ type: 'text' }) codeCiphertext!: string;
  @Column({ type: 'varchar', length: 32 }) festivalId!: string;
  @Column({ type: 'varchar', length: 32, nullable: true }) flagId!:
    string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) label!:
    string | null;
  @Column({ type: 'timestamptz' }) expiresAt!: Date;
  @Column({ type: 'uuid', nullable: true }) usedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) usedAt!: Date | null;
}

@Entity('flag_reports')
@Index('IDX_flag_reports_flag_user', ['flagId', 'userId'], { unique: true })
export class FlagReport {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 32 }) flagId!: string;
  @Column({ type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar', length: 20 }) reason!:
    'fake' | 'inappropriate' | 'other';
  @Column({ type: 'varchar', length: 200, nullable: true }) note!:
    string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity('flag_status_events')
export class FlagStatusEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 32 }) flagId!: string;
  @Column({ type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar', length: 20 }) status!: FlagLifecycle;
  @Column({ type: 'varchar', length: 32, nullable: true }) zoneId!:
    string | null;
  @Column({ type: 'varchar', length: 20, nullable: true })
  activity!: FlagActivity | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity('flag_claim_attempts')
export class FlagClaimAttempt {
  @PrimaryColumn({ type: 'uuid' }) userId!: string;
  @Column({ type: 'integer', default: 0 }) failures!: number;
  @Column({ type: 'timestamptz', nullable: true }) firstFailedAt!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) lockedUntil!: Date | null;
}

@Entity('flag_claim_budgets')
export class FlagClaimBudget {
  @PrimaryColumn({ type: 'varchar', length: 64 }) keyHash!: string;
  @Column({ type: 'integer', default: 0 }) failures!: number;
  @Column({ type: 'timestamptz' }) firstFailedAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) lockedUntil!: Date | null;
}

@Entity('flag_idempotency')
@Index('IDX_flag_idempotency_user_key', ['userId', 'key'], { unique: true })
export class FlagIdempotency {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar', length: 128 }) key!: string;
  @Column({ type: 'varchar', length: 100 }) operation!: string;
  @Column({ type: 'varchar', length: 64 }) requestHash!: string;
  @Column({ type: 'jsonb' }) response!: Record<string, unknown>;
  @Column({ type: 'timestamptz' }) expiresAt!: Date;
}
