import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CrawlKind =
  'timetable' | 'notice' | 'directions' | 'days' | 'discovery' | 'artist-image';
export type CrawlParser =
  'html-table' | 'html-text' | 'image-ocr' | 'regex-days' | 'ticket-list';

@Entity('crawl_sources')
export class CrawlSource {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 32, nullable: true }) festivalId!:
    string | null;
  @Column({ type: 'varchar' }) kind!: CrawlKind;
  @Column({ type: 'varchar' }) url!: string;
  @Column({ type: 'varchar' }) parser!: CrawlParser;
  @Column({ type: 'jsonb', default: '{}' }) parserConfig!: Record<
    string,
    string
  >;
  @Column({ type: 'integer', default: 1440 }) intervalMinutes!: number;
  @Column({ type: 'boolean', default: true }) enabled!: boolean;
  @Column({ type: 'varchar', default: 'ok' }) status!:
    'ok' | 'broken' | 'disabled';
  @Column({ type: 'timestamptz', nullable: true }) lastRunAt!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) lastChangedAt!: Date | null;
  @Column({ type: 'integer', default: 0 }) consecutiveFailures!: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
