import { MigrationInterface, QueryRunner } from 'typeorm';

export class Flags1792500006000 implements MigrationInterface {
  name = 'Flags1792500006000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "flags" (
      "id" varchar(32) PRIMARY KEY, "festivalId" varchar(32) NOT NULL,
      "name" varchar(20) NOT NULL, "visibility" varchar(20) NOT NULL DEFAULT 'public',
      "thumbUrl" varchar, "photoUrl" varchar, "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "bio" varchar(60), "followerCount" integer NOT NULL DEFAULT 0,
      "planVisible" boolean NOT NULL DEFAULT true, "plan" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "homeZoneId" varchar(32), "zoneId" varchar(32),
      "status" varchar(20) NOT NULL DEFAULT 'scheduled', "activity" varchar(20),
      "hidden" boolean NOT NULL DEFAULT false, "reportCount" integer NOT NULL DEFAULT 0,
      "ownerId" uuid, "restartDate" date, "statusUpdatedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_flags_festival" FOREIGN KEY ("festivalId") REFERENCES "admin_festivals"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_flags_festival_name" ON "flags" ("festivalId", "name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_flags_festival_visibility" ON "flags" ("festivalId", "visibility", "hidden")`,
    );
    await queryRunner.query(`CREATE TABLE "flag_follows" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL,
      "flagId" varchar(32) NOT NULL, "festivalId" varchar(32) NOT NULL,
      "followedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_flag_follows_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_flag_follows_flag" FOREIGN KEY ("flagId") REFERENCES "flags"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_flag_follows_user_flag" ON "flag_follows" ("userId", "flagId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_flag_follows_user_time" ON "flag_follows" ("userId", "followedAt" DESC)`,
    );
    await queryRunner.query(`CREATE TABLE "flag_pins" (
      "userId" uuid PRIMARY KEY, "flagId" varchar(32),
      CONSTRAINT "FK_flag_pins_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_flag_pins_flag" FOREIGN KEY ("flagId") REFERENCES "flags"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE TABLE "flag_bearers" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "flagId" varchar(32) NOT NULL,
      "userId" uuid NOT NULL, "festivalId" varchar(32) NOT NULL, "isOwner" boolean NOT NULL DEFAULT false,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_flag_bearers_flag" FOREIGN KEY ("flagId") REFERENCES "flags"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_flag_bearers_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_flag_bearers_flag_user" ON "flag_bearers" ("flagId", "userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_flag_bearers_user_festival" ON "flag_bearers" ("userId", "festivalId")`,
    );
    await queryRunner.query(`CREATE TABLE "flag_bearer_codes" (
      "codeHash" varchar(64) PRIMARY KEY, "festivalId" varchar(32) NOT NULL,
      "codeCiphertext" text NOT NULL,
      "flagId" varchar(32), "label" varchar(100), "expiresAt" timestamptz NOT NULL,
      "usedBy" uuid, "usedAt" timestamptz,
      CONSTRAINT "FK_flag_bearer_codes_festival" FOREIGN KEY ("festivalId") REFERENCES "admin_festivals"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_flag_bearer_codes_flag" FOREIGN KEY ("flagId") REFERENCES "flags"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE "flag_reports" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "flagId" varchar(32) NOT NULL,
      "userId" uuid NOT NULL, "reason" varchar(20) NOT NULL, "note" varchar(200),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_flag_reports_flag" FOREIGN KEY ("flagId") REFERENCES "flags"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_flag_reports_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_flag_reports_flag_user" ON "flag_reports" ("flagId", "userId")`,
    );
    await queryRunner.query(`CREATE TABLE "flag_status_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "flagId" varchar(32) NOT NULL,
      "userId" uuid NOT NULL, "status" varchar(20) NOT NULL,
      "zoneId" varchar(32), "activity" varchar(20), "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_flag_status_events_flag" FOREIGN KEY ("flagId") REFERENCES "flags"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_flag_status_events_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_flag_status_events_flag_time" ON "flag_status_events" ("flagId", "createdAt" DESC)`,
    );
    await queryRunner.query(`CREATE TABLE "flag_claim_attempts" (
      "userId" uuid PRIMARY KEY, "failures" integer NOT NULL DEFAULT 0,
      "firstFailedAt" timestamptz, "lockedUntil" timestamptz,
      CONSTRAINT "FK_flag_claim_attempts_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE "flag_claim_budgets" (
      "keyHash" varchar(64) PRIMARY KEY, "failures" integer NOT NULL DEFAULT 0,
      "firstFailedAt" timestamptz NOT NULL, "lockedUntil" timestamptz
    )`);
    await queryRunner.query(`CREATE TABLE "flag_idempotency" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL,
      "key" varchar(128) NOT NULL, "operation" varchar(100) NOT NULL,
      "requestHash" varchar(64) NOT NULL, "response" jsonb NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      CONSTRAINT "FK_flag_idempotency_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_flag_idempotency_user_key" ON "flag_idempotency" ("userId", "key")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'flag_claim_budgets',
      'flag_idempotency',
      'flag_claim_attempts',
      'flag_status_events',
      'flag_reports',
      'flag_bearer_codes',
      'flag_bearers',
      'flag_pins',
      'flag_follows',
      'flags',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
