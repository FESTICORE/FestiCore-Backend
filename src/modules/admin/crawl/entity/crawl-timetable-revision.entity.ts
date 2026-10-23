import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface CrawlTimetableSet {
  artist: string;
  date: string;
  stageName: string;
  startsAt: string;
  endsAt: string | null;
}

@Entity('crawl_timetable_revisions')
@Index(
  'IDX_crawl_timetable_source_content',
  ['sourceId', 'contentHash', 'parserHash'],
  { unique: true },
)
export class CrawlTimetableRevision {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) sourceId!: string;
  @Column({ type: 'uuid' }) runId!: string;
  @Column({ type: 'varchar', length: 2048 }) festivalSourceUrl!: string;
  @Column({ type: 'varchar', length: 2048 }) sourceUrl!: string;
  @Column({ type: 'uuid', nullable: true }) imageId!: string | null;
  @Column({ type: 'varchar', length: 64 }) contentHash!: string;
  @Column({ type: 'varchar', length: 64 }) parserHash!: string;
  @Column({ type: 'jsonb' }) sets!: CrawlTimetableSet[];
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status!:
    'pending' | 'verified' | 'rejected';
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) verifiedAt!: Date | null;
  @Column({ type: 'uuid', nullable: true }) verifiedBy!: string | null;
}
