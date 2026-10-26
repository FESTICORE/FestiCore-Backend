import { MigrationInterface, QueryRunner } from 'typeorm';

const NOL_WORLD_LISTS = [
  'https://world.nol.com/en/ticket/genre/CONCERT/products',
  'https://world.nol.com/en/ticket',
  'https://world.nol.com/en/search?q=festival',
];

export class NolWorldConcertSource1792500087000 implements MigrationInterface {
  name = 'NolWorldConcertSource1792500087000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const url of NOL_WORLD_LISTS) {
      await queryRunner.query(
        `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'discovery', $1::varchar, 'ticket-list', '{"seed":"nol-world-concert"}', now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
        [url],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const url of NOL_WORLD_LISTS) {
      await queryRunner.query(
        `DELETE FROM crawl_sources source WHERE source."url" = $1
       AND source."kind" = 'discovery' AND source."parser" = 'ticket-list'
       AND source."parserConfig"->>'seed' = 'nol-world-concert'
       AND NOT EXISTS (SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id)
       AND NOT EXISTS (SELECT 1 FROM crawl_proposals proposal WHERE proposal."sourceId" = source.id)
       AND NOT EXISTS (SELECT 1 FROM crawl_images image WHERE image."sourceId" = source.id)
       AND NOT EXISTS (SELECT 1 FROM crawl_alerts alert WHERE alert."sourceId" = source.id)`,
        [url],
      );
    }
  }
}
