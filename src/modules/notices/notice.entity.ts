import {
  Column,
  CreateDateColumn,
  Entity,
  Check,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('notices')
@Index('IDX_notices_published_list', ['publishedAt', 'id'], {
  where: '"published" = true',
})
@Check(
  'CHK_notices_publish_state',
  '("published" = false AND "publishedAt" IS NULL) OR ("published" = true AND "publishedAt" IS NOT NULL)',
)
export class Notice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'boolean', default: false })
  published!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
