import { MigrationInterface, QueryRunner } from 'typeorm';

export class AppleRevokeRetry1792500011000 implements MigrationInterface {
  name = 'AppleRevokeRetry1792500011000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "apple_revoke_retries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tokenHash" varchar(64) NOT NULL,
        "clientId" varchar NOT NULL,
        "ciphertext" text NOT NULL,
        "iv" varchar(24) NOT NULL,
        "authTag" varchar(24) NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
        "exhaustedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_apple_revoke_retries_token_hash" ON "apple_revoke_retries" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_apple_revoke_retries_due" ON "apple_revoke_retries" ("nextAttemptAt") WHERE "exhaustedAt" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "apple_revoke_retries"`);
  }
}
