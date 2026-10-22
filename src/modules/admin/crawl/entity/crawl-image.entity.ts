import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('crawl_images')
@Index(
  'IDX_crawl_images_source_url_content',
  ['sourceId', 'urlHash', 'contentHash'],
  { unique: true },
)
export class CrawlImage {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) sourceId!: string;
  @Column({ type: 'uuid' }) runId!: string;
  @Column({ type: 'varchar', length: 2048 }) originUrl!: string;
  @Column({ type: 'varchar', length: 64 }) urlHash!: string;
  @Column({ type: 'varchar', length: 64 }) contentHash!: string;
  @Column({ type: 'varchar', length: 75, select: false }) objectKey!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'timestamptz', default: () => 'now()' }) lastSeenAt!: Date;
}
