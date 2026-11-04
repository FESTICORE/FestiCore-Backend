import { MigrationInterface, QueryRunner } from 'typeorm';

const SOURCES = [
  {
    url: 'https://mintpaper.co.kr/festivals/178/notice/4870',
    config: {
      seed: 'official-lineup',
      festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
      festivalSourceUrls: [
        'https://mintpaper.co.kr/festivals/178',
        'https://ticket.yes24.com/Perf/60590',
        'https://ticket.yes24.com/English/Perf/60590',
      ],
    },
  },
  {
    url: 'https://nol.yanolja.com/ticket/products/26015181',
    config: { seed: 'something-new-official-detail' },
  },
];

export class CdfSecondLineupSomethingNew1792500104000 implements MigrationInterface {
  name = 'CdfSecondLineupSomethingNew1792500104000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const source of SOURCES)
      await queryRunner.query(
        `INSERT INTO crawl_sources (kind, url, parser, "parserConfig", "createdAt")
         SELECT 'discovery', $1::varchar, 'ticket-list', $2::jsonb, now() - interval '1 day'
         WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE url = $1)`,
        [source.url, JSON.stringify(source.config)],
      );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const source of SOURCES)
      await queryRunner.query(
        `DELETE FROM crawl_sources source WHERE source.url = $1 AND source.kind = 'discovery'
         AND source."parserConfig"->>'seed' = $2
         AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = source.id)
         AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = source.id)
         AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = source.id)
         AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = source.id)`,
        [source.url, source.config.seed],
      );
  }
}
