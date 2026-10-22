import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CrewState = 'here' | 'eating' | 'toilet' | 'leaving';

@Entity('crews')
@Index('UQ_crews_invite_code', ['inviteCode'], { unique: true })
export class Crew {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  festivalId!: string;

  @Column({ type: 'varchar', length: 20 })
  name!: string;

  @Column({ type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'varchar', length: 6 })
  inviteCode!: string;

  @Column({ type: 'timestamptz' })
  inviteExpiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastGatherAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('crew_members')
@Index('UQ_crew_members_festival_user', ['festivalId', 'userId'], {
  unique: true,
})
export class CrewMember {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  crewId!: string;

  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  festivalId!: string;

  @Column({ type: 'varchar', length: 12 })
  nickname!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  zoneId!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  state!: CrewState | null;

  @Column({ type: 'timestamptz', nullable: true })
  statusUpdatedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt!: Date;
}

@Entity('crew_gathers')
export class CrewGather {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  crewId!: string;

  @Column({ type: 'uuid' })
  byUserId!: string;

  @Column({ type: 'varchar', length: 32 })
  zoneId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('crew_status_idempotency')
@Index('IDX_crew_status_idempotency_user_key', ['userId', 'key'], {
  unique: true,
})
export class CrewStatusIdempotency {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar', length: 128 }) key!: string;
  @Column({ type: 'varchar', length: 64 }) requestHash!: string;
  @Column({ type: 'jsonb' }) response!: Record<string, unknown>;
  @Column({ type: 'timestamptz' }) expiresAt!: Date;
}
