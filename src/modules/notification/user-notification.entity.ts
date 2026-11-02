import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** 사용자 단위 알림함 항목. 기기별 발송 큐와 별개로 계정에 한 번만 쌓는다. */
@Entity('user_notifications')
@Index('UQ_user_notifications_user_dedupe', ['userId', 'dedupeKey'], {
  unique: true,
})
@Index('IDX_user_notifications_user_created', ['userId', 'createdAt', 'id'])
export class UserNotification {
  @PrimaryColumn({
    type: 'varchar',
    length: 36,
    default: () => `'ntf_' || replace(gen_random_uuid()::text, '-', '')`,
  })
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  festivalId!: string | null;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @Column({ type: 'varchar', length: 240 })
  body!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  route!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  subject!: Record<string, string>;

  @Column({ type: 'varchar', length: 160 })
  dedupeKey!: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;
}
