import { MigrationInterface, QueryRunner } from 'typeorm';

export class PackUpdateSubscriptionIndex1792500028000 implements MigrationInterface {
  name = 'PackUpdateSubscriptionIndex1792500028000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_device_subscriptions_pack_updates"
      ON "device_subscriptions"("festivalId") WHERE "packUpdates" = true`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX "IDX_device_subscriptions_pack_updates"',
    );
  }
}
