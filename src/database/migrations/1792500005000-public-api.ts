import { MigrationInterface, QueryRunner } from 'typeorm';

export class PublicApi1792500005000 implements MigrationInterface {
  name = 'PublicApi1792500005000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE public_live_rate_limits (
      device_id uuid NOT NULL,
      minute bigint NOT NULL,
      count integer NOT NULL,
      PRIMARY KEY (device_id, minute)
    )`);
    await queryRunner.query(
      'CREATE INDEX IDX_public_live_rate_limits_minute ON public_live_rate_limits (minute)',
    );
    await queryRunner.query(`CREATE INDEX "IDX_admin_festivals_public_dates"
      ON "admin_festivals" ((("published"->'days'->-1->>'date')))
      WHERE "published" IS NOT NULL AND "publishedVersion" > 0`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_admin_festivals_public_dates"');
    await queryRunner.query('DROP TABLE public_live_rate_limits');
  }
}
