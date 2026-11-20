import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 축제 공식 인스타그램 최근 게시물과 계정별 수집 상태, 기기별 새 게시물 알림 설정.
 * 축제가 지워지면 수집 기록도 함께 지운다. 기존 기기는 알림이 켜진 상태로 시작한다.
 */
export class OfficialInstagramNews1792500110000 implements MigrationInterface {
  name = 'OfficialInstagramNews1792500110000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "devices"
      ADD COLUMN IF NOT EXISTS "notifyOfficialNews" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "official_instagram_feeds" (
        "festivalId" varchar(32) NOT NULL REFERENCES "admin_festivals"("id") ON DELETE CASCADE,
        "username" varchar(64) NOT NULL,
        "seededAt" timestamptz,
        "lastFetchedAt" timestamptz,
        "lastErrorCode" varchar(64),
        CONSTRAINT "PK_official_instagram_feeds" PRIMARY KEY ("festivalId")
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "official_instagram_posts" (
        "festivalId" varchar(32) NOT NULL REFERENCES "admin_festivals"("id") ON DELETE CASCADE,
        "mediaId" varchar(64) NOT NULL,
        "caption" text,
        "mediaType" varchar(32) NOT NULL,
        "imageUrl" text,
        "permalink" text NOT NULL,
        "postedAt" timestamptz NOT NULL,
        "fetchedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_official_instagram_posts" PRIMARY KEY ("festivalId", "mediaId")
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_official_instagram_posts_recent"
      ON "official_instagram_posts" ("festivalId", "postedAt")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "official_instagram_posts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "official_instagram_feeds"`);
    await queryRunner.query(`ALTER TABLE "devices"
      DROP COLUMN IF EXISTS "notifyOfficialNews"`);
  }
}
