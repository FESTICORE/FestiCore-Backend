import { MigrationInterface, QueryRunner } from 'typeorm';

export class LegalDocuments1792500041000 implements MigrationInterface {
  name = 'LegalDocuments1792500041000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "legal_documents" (
      "kind" varchar(32) PRIMARY KEY,
      "content" text NOT NULL,
      "version" integer NOT NULL,
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "updatedBy" uuid NULL
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "legal_documents"');
  }
}
