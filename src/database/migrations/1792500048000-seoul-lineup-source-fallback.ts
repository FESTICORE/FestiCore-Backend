import { MigrationInterface, QueryRunner } from 'typeorm';

const OLD_URL =
  'https://culture.seoul.go.kr/culture/culture/cultureEvent/view.do?cultcode=159493&menuNo=200011';
const NEW_URL =
  'https://festival.seoul.go.kr/festival/main/festivalView.do?festacode=848';

export class SeoulLineupSourceFallback1792500048000 implements MigrationInterface {
  name = 'SeoulLineupSourceFallback1792500048000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const collision: unknown = await queryRunner.query(
      `SELECT id FROM crawl_sources WHERE "url" = $2
       AND EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1
         AND "kind" = 'discovery' AND "parserConfig"->>'seed' = 'official-lineup')
       LIMIT 1`,
      [OLD_URL, NEW_URL],
    );
    if (Array.isArray(collision) && collision.length)
      throw new Error('서울뮤직 대체 수집 주소가 이미 등록되어 있습니다.');
    await queryRunner.query(
      `UPDATE crawl_sources SET "url" = $2, "createdAt" = now() - interval '1 day',
         "consecutiveFailures" = 0,
         "status" = CASE WHEN "enabled" THEN 'ok' ELSE "status" END,
         "updatedAt" = now()
       WHERE "url" = $1 AND "kind" = 'discovery'
         AND "parserConfig"->>'seed' = 'official-lineup'`,
      [OLD_URL, NEW_URL],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources SET "url" = $1, "updatedAt" = now()
       WHERE "url" = $2 AND "kind" = 'discovery'
         AND "parserConfig"->>'seed' = 'official-lineup'
         AND NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [OLD_URL, NEW_URL],
    );
  }
}
