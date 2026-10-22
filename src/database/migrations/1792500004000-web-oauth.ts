import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebOauth1792500004000 implements MigrationInterface {
  name = 'WebOauth1792500004000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "web_oauth_states" (
      "stateHash" varchar(64) PRIMARY KEY,
      "browserHash" varchar(64) NOT NULL,
      "provider" varchar(16) NOT NULL CHECK ("provider" IN ('google', 'apple')),
      "nonce" varchar(64) NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "consumedAt" timestamptz
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_web_oauth_states_expires_at" ON "web_oauth_states" ("expiresAt")`,
    );
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "web_oauth_tickets" (
      "ticketHash" varchar(64) PRIMARY KEY,
      "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "newUser" boolean NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "consumedAt" timestamptz
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_web_oauth_tickets_expires_at" ON "web_oauth_tickets" ("expiresAt")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "web_oauth_tickets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "web_oauth_states"`);
  }
}
