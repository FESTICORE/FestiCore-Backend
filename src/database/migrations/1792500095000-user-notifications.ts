import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserNotifications1792500095000 implements MigrationInterface {
  name = 'UserNotifications1792500095000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "user_notifications" (
      "id" varchar(36) NOT NULL
        DEFAULT 'ntf_' || replace(gen_random_uuid()::text, '-', ''),
      "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "type" varchar(32) NOT NULL,
      "festivalId" varchar(32),
      "title" varchar(120) NOT NULL,
      "body" varchar(240) NOT NULL,
      "route" varchar(200),
      "subject" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "dedupeKey" varchar(160) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "readAt" timestamptz,
      CONSTRAINT "PK_user_notifications" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_user_notifications_user_dedupe"
      ON "user_notifications" ("userId", "dedupeKey")`);
    await queryRunner.query(`CREATE INDEX "IDX_user_notifications_user_created"
      ON "user_notifications" ("userId", "createdAt", "id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "user_notifications"');
  }
}
