import { MigrationInterface, QueryRunner } from 'typeorm';

const SOURCES = [
  {
    url: 'https://www.mintpaper.co.kr/posts/4819',
    festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
  },
  {
    url: 'https://ticket.melon.com/csoon/detail.htm?csoonId=12728',
    festivalSourceUrl:
      'https://ticket.melon.com/performance/index.htm?prodId=213769',
  },
];

export class OfficialLineupSources1792500045000 implements MigrationInterface {
  name = 'OfficialLineupSources1792500045000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const source of SOURCES) {
      await queryRunner.query(
        `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
         SELECT 'discovery', $1::varchar, 'ticket-list', $2::jsonb, now() - interval '1 day'
         WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
        [
          source.url,
          JSON.stringify({
            seed: 'official-lineup',
            festivalSourceUrl: source.festivalSourceUrl,
          }),
        ],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const source of SOURCES) {
      await queryRunner.query(
        `DELETE FROM crawl_sources WHERE "url" = $1 AND "kind" = 'discovery'
         AND "parserConfig"->>'seed' = 'official-lineup'
         AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
        [source.url],
      );
    }
  }
}
