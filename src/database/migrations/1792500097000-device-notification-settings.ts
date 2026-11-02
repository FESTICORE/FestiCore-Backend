import { MigrationInterface, QueryRunner } from 'typeorm';

/** 기기별 알림 종류 설정. 기존 기기는 모두 켜진 상태로 시작한다. */
export class DeviceNotificationSettings1792500097000 implements MigrationInterface {
  name = 'DeviceNotificationSettings1792500097000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "devices"
      ADD COLUMN IF NOT EXISTS "notifyFlagStatus" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "notifyCrewStatus" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "notifyCrewGather" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "notifySetReminders" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "notifyHomecoming" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "notifyPackUpdates" boolean NOT NULL DEFAULT true`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "devices"
      DROP COLUMN IF EXISTS "notifyFlagStatus",
      DROP COLUMN IF EXISTS "notifyCrewStatus",
      DROP COLUMN IF EXISTS "notifyCrewGather",
      DROP COLUMN IF EXISTS "notifySetReminders",
      DROP COLUMN IF EXISTS "notifyHomecoming",
      DROP COLUMN IF EXISTS "notifyPackUpdates"`);
  }
}
