import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminAuth1792500001000 implements MigrationInterface {
  name = 'AdminAuth1792500001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "admin_accounts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" varchar NOT NULL,
      "role" varchar NOT NULL CHECK ("role" IN ('owner', 'editor', 'viewer')),
      "active" boolean NOT NULL DEFAULT true,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_admin_accounts_email" ON "admin_accounts" ("email")`,
    );
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "admin_magic_links" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "adminId" uuid NOT NULL REFERENCES "admin_accounts"("id") ON DELETE CASCADE,
      "tokenHash" varchar NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "consumedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_admin_magic_links_token_hash" ON "admin_magic_links" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_magic_links_admin_id" ON "admin_magic_links" ("adminId")`,
    );
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "admin_sessions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "adminId" uuid NOT NULL REFERENCES "admin_accounts"("id") ON DELETE CASCADE,
      "tokenHash" varchar NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "revokedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_admin_sessions_token_hash" ON "admin_sessions" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_sessions_admin_id" ON "admin_sessions" ("adminId")`,
    );
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "admin_auth_audit" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "adminId" uuid REFERENCES "admin_accounts"("id") ON DELETE SET NULL,
      "action" varchar NOT NULL,
      "ipAddress" varchar,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_auth_audit_created_at" ON "admin_auth_audit" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_auth_audit_rate_limit" ON "admin_auth_audit" ("action", "ipAddress", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_auth_audit"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_magic_links"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_accounts"`);
  }
}
