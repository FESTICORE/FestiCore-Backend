import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveUnusedAdminAuthAudit1792500035000 implements MigrationInterface {
  name = 'RemoveUnusedAdminAuthAudit1792500035000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "admin_auth_audit") THEN
          RAISE EXCEPTION 'admin_auth_audit contains rows; review before dropping';
        END IF;
      END
      $$
    `);
    await queryRunner.query(`DROP TABLE "admin_auth_audit"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "admin_auth_audit" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "adminId" uuid REFERENCES "admin_accounts"("id") ON DELETE SET NULL,
      "action" varchar NOT NULL,
      "ipAddress" varchar,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_admin_auth_audit_created_at" ON "admin_auth_audit" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_admin_auth_audit_rate_limit" ON "admin_auth_audit" ("action", "ipAddress", "createdAt")`,
    );
  }
}
