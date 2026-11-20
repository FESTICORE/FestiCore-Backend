import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** 축제별 공식 인스타그램 계정의 수집 상태. 처음 받은 게시물은 기준선으로만 쓴다. */
@Entity('official_instagram_feeds')
export class OfficialInstagramFeed {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  festivalId!: string;

  @Column({ type: 'varchar', length: 64 })
  username!: string;

  /** 첫 수집을 마친 시각. 이 전에 받은 게시물은 알리지 않는다. */
  @Column({ type: 'timestamptz', nullable: true })
  seededAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastFetchedAt!: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  lastErrorCode!: string | null;
}

/** 축제 공식 인스타그램 최근 게시물. 축제별로 최근 몇 개만 남긴다. */
@Entity('official_instagram_posts')
@Index('IDX_official_instagram_posts_recent', ['festivalId', 'postedAt'])
export class OfficialInstagramPost {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  festivalId!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  mediaId!: string;

  @Column({ type: 'text', nullable: true })
  caption!: string | null;

  @Column({ type: 'varchar', length: 32 })
  mediaType!: string;

  @Column({ type: 'text', nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'text' })
  permalink!: string;

  @Column({ type: 'timestamptz' })
  postedAt!: Date;

  @Column({ type: 'timestamptz' })
  fetchedAt!: Date;
}
