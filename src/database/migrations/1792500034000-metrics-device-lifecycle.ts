import { MigrationInterface, QueryRunner } from 'typeorm';

export class MetricsDeviceLifecycle1792500034000 implements MigrationInterface {
  name = 'MetricsDeviceLifecycle1792500034000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "metric_events" m
      WHERE NOT EXISTS (SELECT 1 FROM "devices" d WHERE d."id" = m."deviceId")`);
    await queryRunner.query(`CREATE INDEX "IDX_metric_events_deviceId"
      ON "metric_events"("deviceId")`);
    await queryRunner.query(`ALTER TABLE "metric_events"
      ADD CONSTRAINT "FK_metric_events_deviceId" FOREIGN KEY ("deviceId")
      REFERENCES "devices"("id") ON DELETE CASCADE`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "metric_events" DROP CONSTRAINT "FK_metric_events_deviceId"',
    );
    await queryRunner.query('DROP INDEX "IDX_metric_events_deviceId"');
  }
}
