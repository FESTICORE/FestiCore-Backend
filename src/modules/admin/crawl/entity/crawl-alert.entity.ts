import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('crawl_alerts')
export class CrawlAlert {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) sourceId!: string;
  @Column({ type: 'uuid', unique: true }) runId!: string;
  @Column({ type: 'varchar' }) reason!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) acknowledgedAt!: Date | null;
  @Column({ type: 'uuid', nullable: true }) acknowledgedBy!: string | null;
}
