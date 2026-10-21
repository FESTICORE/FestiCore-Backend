import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('devices')
export class Device {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true, select: false })
  apnsToken!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  apnsEnvironment!: 'sandbox' | 'production' | null;

  @Column({ type: 'varchar', length: 256, nullable: true, select: false })
  liveActivityPushToStartToken!: string | null;

  @Column({ type: 'varchar', length: 32 })
  appVersion!: string;

  @Column({ type: 'varchar', length: 64 })
  osVersion!: string;

  @Column({ type: 'varchar', length: 35 })
  locale!: string;

  @Column({ type: 'varchar', length: 64 })
  timezone!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  liveActivityFestivalId!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  liveActivityId!: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true, select: false })
  liveActivityPushToken!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('device_subscriptions')
export class DeviceSubscription {
  @PrimaryColumn({ type: 'uuid' })
  deviceId!: string;

  @PrimaryColumn({ type: 'varchar', length: 32 })
  festivalId!: string;

  @Column({ type: 'boolean' })
  packUpdates!: boolean;

  @Column({ type: 'boolean', default: false })
  festivalStarts!: boolean;
}
