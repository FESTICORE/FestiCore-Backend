import { MigrationInterface, QueryRunner } from 'typeorm';

const PAGE = 'https://litt.ly/wonderlivet';
const FESTIVAL = 'https://www.wonderli.vet/lineup';
const SEED = 'wonderlivet-official-ticket-links';

export class WonderlivetOfficialTicketLink1792500072000 implements MigrationInterface {
  name = 'WonderlivetOfficialTicketLink1792500072000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources (kind, url, parser, "parserConfig", "intervalMinutes", "createdAt")
       SELECT 'discovery', $1::text, 'ticket-list',
         jsonb_build_object('seed', $2::text, 'festivalSourceUrl', $3::text),
         1440, now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE url = $1::text)`,
      [PAGE, SEED, FESTIVAL],
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
