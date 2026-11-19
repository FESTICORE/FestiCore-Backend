import { MigrationInterface, QueryRunner } from 'typeorm';

/** 기기 Live Activity 등록 시각을 저장해 iOS가 끝낸 오래된 등록을 구분한다. */
export class LiveActivityRegisteredAt1792500107000 implements MigrationInterface {
  name = 'LiveActivityRegisteredAt1792500107000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "liveActivityRegisteredAt" timestamptz`,
    );
    // 기존 등록은 마지막 기기 갱신 시각을 등록 시각으로 본다.
    await queryRunner.query(
      `UPDATE "devices" SET "liveActivityRegisteredAt" = "updatedAt"
       WHERE "liveActivityId" IS NOT NULL AND "liveActivityRegisteredAt" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "devices" DROP COLUMN IF EXISTS "liveActivityRegisteredAt"`,
    );
  }
}
