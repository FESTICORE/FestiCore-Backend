import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 컬럼 추가 전에 바뀐 깃발 상태의 변경자를 최신 상태 이력으로 채운다.
 * 관리자 강제 변경이나 탈퇴로 이력의 userId가 NULL이면 그대로 둔다.
 */
export class FlagStatusUpdatedByBackfill1792500099000 implements MigrationInterface {
  name = 'FlagStatusUpdatedByBackfill1792500099000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "flags" f
      SET "statusUpdatedBy" = latest."userId"
      FROM (
        SELECT DISTINCT ON ("flagId") "flagId", "userId"
        FROM "flag_status_events"
        ORDER BY "flagId", "createdAt" DESC, "id" DESC
      ) latest
      WHERE latest."flagId" = f."id"
        AND latest."userId" IS NOT NULL
        AND f."statusUpdatedBy" IS NULL`);
  }

  public async down(): Promise<void> {
    // 채운 값과 이후 정상 기록을 구분할 수 없어 되돌리지 않는다.
  }
}
