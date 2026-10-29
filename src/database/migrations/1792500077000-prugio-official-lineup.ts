import { MigrationInterface, QueryRunner } from 'typeorm';

const PAGE =
  'https://www.mcst.go.kr/site/s_culture/culture/cultureView.jsp?pRo=160&pSeq=75117';
const SEED = 'mcst-prugio-lineup';

export class PrugioOfficialLineup1792500077000 implements MigrationInterface {
  name = 'PrugioOfficialLineup1792500077000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources (kind, url, parser, "parserConfig", "intervalMinutes", "createdAt")
       SELECT 'discovery', $1::text, 'ticket-list', jsonb_build_object('seed', $2::text),
         1440, now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE url = $1::text)`,
      [PAGE, SEED],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources source WHERE source.kind = 'discovery'
         AND source.url = $1::text AND source."parserConfig"->>'seed' = $2::text
         AND NOT EXISTS (SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id)
         AND NOT EXISTS (SELECT 1 FROM crawl_proposals p WHERE p."sourceId" = source.id)`,
      [PAGE, SEED],
    );
  }
}
