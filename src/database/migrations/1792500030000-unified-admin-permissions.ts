import { MigrationInterface, QueryRunner } from 'typeorm';

export class UnifiedAdminPermissions1792500030000 implements MigrationInterface {
  name = 'UnifiedAdminPermissions1792500030000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admin_accounts" ADD COLUMN "userId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_accounts" ADD CONSTRAINT "FK_admin_accounts_user_id" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_admin_accounts_user_id" ON "admin_accounts" ("userId")`,
    );
    await queryRunner.query(`DROP TABLE "admin_sessions"`);
    await queryRunner.query(`DROP TABLE "admin_magic_links"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_admin_accounts_user_id"`);
    await queryRunner.query(
      `ALTER TABLE "admin_accounts" DROP CONSTRAINT "FK_admin_accounts_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_accounts" DROP COLUMN "userId"`,
    );
    await queryRunner.query(`CREATE TABLE "admin_magic_links" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "adminId" uuid NOT NULL REFERENCES "admin_accounts"("id") ON DELETE CASCADE,
      "tokenHash" varchar NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "consumedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_admin_magic_links_token_hash" ON "admin_magic_links" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_admin_magic_links_admin_id" ON "admin_magic_links" ("adminId")`,
    );
    await queryRunner.query(`CREATE TABLE "admin_sessions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "adminId" uuid NOT NULL REFERENCES "admin_accounts"("id") ON DELETE CASCADE,
      "tokenHash" varchar NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "revokedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_admin_sessions_token_hash" ON "admin_sessions" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_admin_sessions_admin_id" ON "admin_sessions" ("adminId")`,
    );
  }
}
