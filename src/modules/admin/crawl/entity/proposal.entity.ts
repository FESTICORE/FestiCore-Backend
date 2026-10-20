import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface ProposalItem {
  id: string;
  op: 'add' | 'update' | 'remove';
  path: string;
  before: unknown;
  after: unknown;
  decision: 'pending' | 'accepted' | 'rejected';
  decidedBy: string | null;
  decidedAt: string | null;
}

@Entity('crawl_proposals')
export class Proposal {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 32, nullable: true }) festivalId!:
    string | null;
  @Column({ type: 'uuid', nullable: true }) sourceId!: string | null;
  @Column({ type: 'uuid', nullable: true }) runId!: string | null;
  @Column({ type: 'varchar' }) kind!:
    | 'sets.diff'
    | 'directions.diff'
    | 'days.diff'
    | 'notice.new'
    | 'festival.new';
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'varchar', default: 'open' }) status!:
    'open' | 'applied' | 'rejected' | 'partial';
  @Column({ type: 'double precision', default: 1 }) confidence!: number;
  @Column({ type: 'jsonb', default: '[]' }) items!: ProposalItem[];
  @Column({ type: 'jsonb', default: '{}' }) evidence!: {
    snapshotUrl: string | null;
    excerpt: string;
    imageUrls?: string[];
  };
}
