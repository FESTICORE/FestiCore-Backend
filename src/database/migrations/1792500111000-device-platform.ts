import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 기기 플랫폼(ios · android)과 Android FCM 등록 토큰.
 * 기존 행은 모두 ios · fcmToken NULL이 되어 두 제약을 바로 만족한다.
 * iOS 행은 fcmToken을, Android 행은 APNs · Live Activity 시작 토큰을 가질 수 없다.
 */
export class DevicePlatform1792500111000 implements MigrationInterface {
  name = 'DevicePlatform1792500111000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "devices"
      ADD COLUMN IF NOT EXISTS "platform" varchar(10) NOT NULL DEFAULT 'ios'`);
    await queryRunner.query(`ALTER TABLE "devices"
      ADD COLUMN IF NOT EXISTS "fcmToken" varchar(4096)`);
    await queryRunner.query(`ALTER TABLE "devices" ADD CONSTRAINT "CHK_devices_platform"
      CHECK ("platform" IN ('ios', 'android'))`);
    await queryRunner.query(`ALTER TABLE "devices" ADD CONSTRAINT "CHK_devices_push_token_platform"
      CHECK (("platform" = 'android' OR "fcmToken" IS NULL)
        AND ("platform" = 'ios' OR ("apnsToken" IS NULL AND "apnsEnvironment" IS NULL
          AND "liveActivityPushToStartToken" IS NULL)))`);
  }

  /** Android 행은 APNs 토큰이 없는 행으로 남아 어떤 발송에도 걸리지 않는다. 앱이 재등록하면 토큰이 돌아온다. */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "devices"
      DROP CONSTRAINT IF EXISTS "CHK_devices_push_token_platform"`);
    await queryRunner.query(`ALTER TABLE "devices"
      DROP CONSTRAINT IF EXISTS "CHK_devices_platform"`);
    await queryRunner.query(
      `ALTER TABLE "devices" DROP COLUMN IF EXISTS "fcmToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "devices" DROP COLUMN IF EXISTS "platform"`,
    );
  }
}
