import { MigrationInterface, QueryRunner } from 'typeorm';

const SOURCE_URL =
  'https://culture.seoul.go.kr/culture/culture/cultureEvent/view.do?cultcode=159493&menuNo=200011';

export class SeoulCultureLineup1792500046000 implements MigrationInterface {
  name = 'SeoulCultureLineup1792500046000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'discovery', $1::varchar, 'ticket-list', $2::jsonb, now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [
        SOURCE_URL,
        JSON.stringify({
          seed: 'official-lineup',
          festivalSourceUrl: 'https://ticket.yes24.com/Perf/60368',
          expectedArtists: '6',
        }),
      ],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources WHERE "url" = $1 AND "kind" = 'discovery'
       AND "parserConfig"->>'seed' = 'official-lineup'
       AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
      [SOURCE_URL],
    );
  }
}
