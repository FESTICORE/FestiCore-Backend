import { MigrationInterface, QueryRunner } from 'typeorm';

const DAY_TWO_IMAGE =
  'https://cdn.imweb.me/upload/S20260514ec9937937627b/5a6082d2390bc.jpg';

export class XmfTimetableTimedRows1792500050000 implements MigrationInterface {
  name = 'XmfTimetableTimedRows1792500050000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const result = (await queryRunner.query(
      `UPDATE crawl_sources
       SET "parserConfig" = jsonb_set("parserConfig", '{expectedRows}', '"11"'::jsonb),
           "updatedAt" = now()
       WHERE "url" = $1 AND "parser" = 'image-ocr'
         AND "parserConfig"->>'expectedRows' = '12'
       RETURNING id`,
      [DAY_TWO_IMAGE],
      true,
    )) as { affected?: number };
    if (result.affected !== 1)
      throw new Error(
        'XMF DAY 2의 시각이 표시된 공연 수를 갱신하지 못했습니다.',
      );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const result = (await queryRunner.query(
      `UPDATE crawl_sources
       SET "parserConfig" = jsonb_set("parserConfig", '{expectedRows}', '"12"'::jsonb),
           "updatedAt" = now()
       WHERE "url" = $1 AND "parser" = 'image-ocr'
         AND "parserConfig"->>'expectedRows' = '11'
         AND NOT EXISTS (
           SELECT 1 FROM crawl_timetable_revisions revision
           WHERE revision."sourceId" = crawl_sources.id AND revision.status = 'verified'
         )
       RETURNING id`,
      [DAY_TWO_IMAGE],
      true,
    )) as { affected?: number };
    if (result.affected !== 1)
      throw new Error(
        '발행된 XMF 시간표가 있어 예상 행 수를 복원할 수 없습니다.',
      );
  }
}
