import { MigrationInterface, QueryRunner } from 'typeorm';

const ISO_INSTANT = String.raw`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$`;

/**
 * 귀가 시각 형식(오프셋 포함 ISO8601)을 정하기 전에 저장된 자유 문장(예: "23:40")을
 * 초안과 현재 발행본에서 null로 바꾼다. 공개 응답은 이미 null로 투영하므로 팩 버전은 올리지 않는다.
 * 과거 버전 기록(admin_festival_versions)은 이력이므로 바꾸지 않는다.
 */
export class NormalizeLegacyReturnTimes1792500101000 implements MigrationInterface {
  name = 'NormalizeLegacyReturnTimes1792500101000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['draft', 'published'])
      for (const key of ['lastShuttleAt', 'lastTrainAt'])
        await queryRunner.query(
          `UPDATE "admin_festivals"
           SET "${column}" = jsonb_set("${column}", '{directions,${key}}', 'null'::jsonb)
           WHERE jsonb_typeof("${column}"->'directions') = 'object'
             AND jsonb_typeof("${column}"->'directions'->'${key}') = 'string'
             AND ("${column}"->'directions'->>'${key}') !~ $1`,
          [ISO_INSTANT],
        );
  }

  public async down(): Promise<void> {
    // 지운 자유 문장은 복원할 수 없다.
  }
}
