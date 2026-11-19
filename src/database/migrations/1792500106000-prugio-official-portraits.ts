import { MigrationInterface, QueryRunner } from 'typeorm';
const PRUGIO_PORTRAIT_PAGE_URL =
  'https://ticket.melon.com/performance/index.htm?prodId=213868';
const PRUGIO_PORTRAIT_SEED = 'prugio-official-portraits';
const PRUGIO_LINEUP_URL =
  'https://www.mcst.go.kr/site/s_culture/culture/cultureView.jsp?pRo=160&pSeq=75117';

export class PrugioOfficialPortraits1792500106000 implements MigrationInterface {
  name = 'PrugioOfficialPortraits1792500106000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const conflict = (await queryRunner.query(
      `SELECT id FROM crawl_sources WHERE kind = 'artist-gallery' AND url = $1::text
         AND ("parserConfig"->>'seed' IS DISTINCT FROM $2::text OR
           "parserConfig"->>'festivalSourceUrl' IS DISTINCT FROM $3::text)
       LIMIT 1`,
      [PRUGIO_PORTRAIT_PAGE_URL, PRUGIO_PORTRAIT_SEED, PRUGIO_LINEUP_URL],
    )) as { id: string }[];
    if (conflict.length)
      throw new Error('푸르지오 공식 포스터와 충돌하는 갤러리 소스');
    await queryRunner.query(
      `INSERT INTO crawl_sources
         (kind, url, parser, "parserConfig", "intervalMinutes", "enabled", "status", "createdAt")
       SELECT 'artist-gallery', $1::text, 'html-text',
         jsonb_build_object('seed', $2::text, 'festivalSourceUrl', $3::text),
         1440, false, 'disabled', now() - interval '1 day'
       WHERE NOT EXISTS (
         SELECT 1 FROM crawl_sources WHERE kind = 'artist-gallery' AND url = $1::text
       )`,
      [PRUGIO_PORTRAIT_PAGE_URL, PRUGIO_PORTRAIT_SEED, PRUGIO_LINEUP_URL],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources source
       WHERE source.kind = 'artist-gallery' AND source.url = $1::text
         AND source."parserConfig"->>'seed' = $2::text
         AND source."parserConfig"->>'festivalSourceUrl' = $3::text
         AND NOT EXISTS (SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id)`,
      [PRUGIO_PORTRAIT_PAGE_URL, PRUGIO_PORTRAIT_SEED, PRUGIO_LINEUP_URL],
    );
  }
}
