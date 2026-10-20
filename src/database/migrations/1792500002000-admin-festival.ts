import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminFestival1792500002000 implements MigrationInterface {
  name = 'AdminFestival1792500002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_festivals" (
        "id" varchar(32) PRIMARY KEY,
        "draft" jsonb NOT NULL,
        "draftVersion" integer NOT NULL DEFAULT 1,
        "draftUpdatedBy" varchar,
        "published" jsonb,
        "publishedVersion" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "draftUpdatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_festival_versions" (
        "festivalId" varchar(32) NOT NULL,
        "packVersion" integer NOT NULL,
        "pack" jsonb NOT NULL,
        "publishedBy" varchar,
        "note" varchar(500) NOT NULL DEFAULT '',
        "sizeBytes" integer NOT NULL,
        "publishedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_festival_versions" PRIMARY KEY ("festivalId", "packVersion"),
        CONSTRAINT "FK_admin_festival_versions_festival" FOREIGN KEY ("festivalId") REFERENCES "admin_festivals"("id") ON DELETE CASCADE
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_festival_versions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_festivals"`);
  }
}
