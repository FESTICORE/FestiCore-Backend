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

  @Column({ type: 'uuid', nullable: true })
  deviceTokenId!: string | null;

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

  /** 현재 Live Activity ID를 처음 등록한 시각. 8시간이 지나면 iOS가 끝낸 활동으로 본다. */
  @Column({ type: 'timestamptz', nullable: true })
  liveActivityRegisteredAt!: Date | null;

  @Column({ type: 'boolean', default: true })
  notifyFlagStatus!: boolean;

  @Column({ type: 'boolean', default: true })
  notifyCrewStatus!: boolean;

  @Column({ type: 'boolean', default: true })
  notifyCrewGather!: boolean;

  @Column({ type: 'boolean', default: true })
  notifySetReminders!: boolean;

  @Column({ type: 'boolean', default: true })
  notifyHomecoming!: boolean;

  @Column({ type: 'boolean', default: true })
  notifyPackUpdates!: boolean;

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

  @Column({ type: 'boolean', default: false })
  pinned!: boolean;

  @Column({ type: 'boolean', default: true })
  reminders!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  pinnedAt!: Date | null;

  @Column({ type: 'integer', nullable: true })
  packDownloadedVersion!: number | null;

  @Column({ type: 'boolean' })
  packUpdates!: boolean;

  @Column({ type: 'boolean', default: false })
  festivalStarts!: boolean;
}
