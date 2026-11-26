import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 계정 단위 기수 모드. users.bearerModeOff가 true면 그 사용자가 소유한 깃발의 flags.ownerPaused도 true다.
 * 관리자 숨김(hidden)과 분리해 기수 모드를 다시 켜도 관리자 숨김은 풀리지 않는다.
 * 기존 행은 모두 false(기수 모드 켜짐 · 노출 유지)로 시작한다.
 */
export class BearerMode1792500112000 implements MigrationInterface {
  name = 'BearerMode1792500112000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "bearerModeOff" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "flags"
      ADD COLUMN IF NOT EXISTS "ownerPaused" boolean NOT NULL DEFAULT false`);
  }

  /** 끈 기수 모드 기록이 사라져 숨겨 둔 깃발이 다시 노출된다. 관리자 숨김은 그대로 남는다. */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "flags" DROP COLUMN IF EXISTS "ownerPaused"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "bearerModeOff"`,
    );
  }
}
