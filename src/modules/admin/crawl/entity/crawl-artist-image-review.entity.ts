import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('crawl_artist_image_reviews')
@Index('IDX_crawl_artist_image_review_source', ['sourceId'], { unique: true })
export class CrawlArtistImageReview {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) sourceId!: string;
  @Column({ type: 'uuid', nullable: true }) imageId!: string | null;
  @Column({ type: 'varchar', length: 32 }) festivalId!: string;
  @Column({ type: 'varchar', length: 2048 }) festivalSourceUrl!: string;
  @Column({ type: 'varchar', length: 160 }) artistName!: string;
  @Column({ type: 'integer' }) fileId!: number;
  @Column({ type: 'varchar', length: 2048 }) filePageUrl!: string;
  @Column({ type: 'varchar', length: 2048 }) officialEvidenceUrl!: string;
  @Column({ type: 'uuid' }) discoveryRunId!: string;
  @Column({ type: 'uuid', nullable: true }) preparedRunId!: string | null;
  @Column({ type: 'uuid', nullable: true }) approvedRunId!: string | null;
  @Column({ type: 'varchar', length: 500 }) author!: string;
  @Column({ type: 'varchar', length: 16 }) license!: string;
  @Column({ type: 'varchar', length: 100 }) licenseUrl!: string;
  @Column({ type: 'varchar', length: 64, nullable: true }) originalSha256!:
    string | null;
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status!:
    'pending' | 'approved' | 'revoked';
  @Column({ type: 'uuid', nullable: true }) reviewedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  @Column({ type: 'uuid', nullable: true }) revokedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) verifiedAt!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
