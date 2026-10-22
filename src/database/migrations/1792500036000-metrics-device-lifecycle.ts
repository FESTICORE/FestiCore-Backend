import { MigrationInterface, QueryRunner } from 'typeorm';

export class MetricsDeviceLifecycle1792500036000 implements MigrationInterface {
  name = 'MetricsDeviceLifecycle1792500036000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_metric_events_deviceId"
      ON "metric_events"("deviceId")`);
    // Earlier public ingestion accepted unregistered IDs. Preserve those rows
    // until their retention policy is decided; enforce the FK for new writes.
    await queryRunner.query(`ALTER TABLE "metric_events"
      ADD CONSTRAINT "FK_metric_events_deviceId" FOREIGN KEY ("deviceId")
      REFERENCES "devices"("id") ON DELETE CASCADE NOT VALID`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "metric_events" DROP CONSTRAINT "FK_metric_events_deviceId"',
    );
    await queryRunner.query('DROP INDEX "IDX_metric_events_deviceId"');
  }
}
