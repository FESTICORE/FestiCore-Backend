import { MigrationInterface, QueryRunner } from 'typeorm';

export class Notices1792500103000 implements MigrationInterface {
  name = 'Notices1792500103000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "notices" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "title" varchar(200) NOT NULL,
      "content" text NOT NULL,
      "published" boolean NOT NULL DEFAULT false,
      "publishedAt" timestamptz NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_notices_publish_state" CHECK (
        ("published" = false AND "publishedAt" IS NULL) OR
        ("published" = true AND "publishedAt" IS NOT NULL)
      )
    )`);
    // PostgreSQL은 ASC 인덱스를 역방향으로 스캔해 두 열 모두 DESC 정렬을 처리한다.
    await queryRunner.query(`CREATE INDEX "IDX_notices_published_list"
      ON "notices" ("publishedAt", "id") WHERE "published" = true`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "notices"');
  }
}
