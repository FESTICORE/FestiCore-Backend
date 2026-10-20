import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type FestivalDocument = Record<string, unknown>;

@Entity('admin_festivals')
export class AdminFestival {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column({ type: 'jsonb' })
  draft!: FestivalDocument;

  @Column({ type: 'integer', default: 1 })
  draftVersion!: number;

  @Column({ type: 'varchar', nullable: true })
  draftUpdatedBy!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  published!: FestivalDocument | null;

  @Column({ type: 'integer', default: 0 })
  publishedVersion!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  draftUpdatedAt!: Date;
}

@Entity('admin_festival_versions')
export class AdminFestivalVersion {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  festivalId!: string;

  @PrimaryColumn({ type: 'integer' })
  packVersion!: number;

  @Column({ type: 'jsonb' })
  pack!: FestivalDocument;

  @Column({ type: 'varchar', nullable: true })
  publishedBy!: string | null;

  @Column({ type: 'varchar', length: 500, default: '' })
  note!: string;

  @Column({ type: 'integer' })
  sizeBytes!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  publishedAt!: Date;
}
