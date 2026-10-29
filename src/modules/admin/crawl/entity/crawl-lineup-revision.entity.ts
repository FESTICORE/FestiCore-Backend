import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface ReviewedLineupArtist {
  name: string;
  lineIndex: number;
}

@Entity('crawl_lineup_revisions')
@Index(
  'IDX_crawl_lineup_evidence',
  ['sourceId', 'imageUrl', 'imageHash', 'parserVersion'],
  { unique: true },
)
export class CrawlLineupRevision {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) sourceId!: string;
  @Column({ type: 'uuid' }) runId!: string;
  @Column({ type: 'varchar', length: 2048 }) productUrl!: string;
  @Column({ type: 'varchar', length: 2048 }) imageUrl!: string;
  @Column({ type: 'varchar', length: 64 }) imageHash!: string;
  @Column({ type: 'varchar', length: 80 }) parserVersion!: string;
  @Column({ type: 'jsonb' }) rawLines!: string[];
  @Column({ type: 'jsonb', default: '[]' }) artists!: ReviewedLineupArtist[];
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status!:
    'pending' | 'approved' | 'rejected';
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  @Column({ type: 'uuid', nullable: true }) reviewedBy!: string | null;
}
