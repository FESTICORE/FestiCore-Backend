import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminAudit1792500020000 implements MigrationInterface {
  name = 'AdminAudit1792500020000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "admin_audit" (
      "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      "at" timestamptz NOT NULL DEFAULT now(),
      "actor" varchar(128),
      "action" varchar(100) NOT NULL,
      "target" varchar(200) NOT NULL,
      "before" jsonb,
      "after" jsonb
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_admin_audit_at_id"
      ON "admin_audit"("at" DESC, "id" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_admin_audit_actor_at"
      ON "admin_audit"("actor", "at" DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "admin_audit"');
  }
}
