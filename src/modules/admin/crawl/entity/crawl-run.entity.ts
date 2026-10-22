import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('crawl_runs')
export class CrawlRun {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) sourceId!: string;
  @CreateDateColumn({ type: 'timestamptz' }) startedAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) finishedAt!: Date | null;
  @Column({ type: 'varchar', default: 'running' }) result!:
    'running' | 'unchanged' | 'proposed' | 'nochange-parsed' | 'failed';
  @Column({ type: 'integer', nullable: true }) httpStatus!: number | null;
  @Column({ type: 'varchar', nullable: true }) contentHash!: string | null;
  @Column({ type: 'varchar', nullable: true }) snapshotUrl!: string | null;
  @Column({ type: 'text', nullable: true }) error!: string | null;
  @Column({ type: 'uuid', nullable: true }) proposalId!: string | null;
  @Column({ type: 'date', nullable: true }) scheduledDate!: string | null;
}
