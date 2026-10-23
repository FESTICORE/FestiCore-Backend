import { MigrationInterface, QueryRunner } from 'typeorm';

const FESTIVAL_SOURCE_URL =
  'https://ticket.melon.com/performance/index.htm?prodId=213766';
const OFFICIAL_NOTICE_URL = 'https://xmfestival.com/notice';

const days = [
  {
    date: '2026-10-03',
    imageUrl:
      'https://cdn.imweb.me/upload/S20260514ec9937937627b/48ec09b04dc05.jpg',
  },
  {
    date: '2026-10-04',
    imageUrl:
      'https://cdn.imweb.me/upload/S20260514ec9937937627b/5a6082d2390bc.jpg',
  },
];

const columns = JSON.stringify([
  {
    stageId: 'stg_xmf_a',
    stageName: 'STAGE A',
    left: 0.21,
    top: 0.225,
    width: 0.355,
    height: 0.71,
  },
  {
    stageId: 'stg_xmf_b',
    stageName: 'STAGE B',
    left: 0.565,
    top: 0.225,
    width: 0.36,
    height: 0.71,
  },
]);

export class XmfTimetableSources1792500044000 implements MigrationInterface {
  name = 'XmfTimetableSources1792500044000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const day of days) {
      const config = JSON.stringify({
        festivalSourceUrl: FESTIVAL_SOURCE_URL,
        sourcePageUrl: OFFICIAL_NOTICE_URL,
        date: day.date,
        expectedRows: '12',
        columns,
      });
      await queryRunner.query(
        `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
         SELECT 'timetable', $1::varchar, 'image-ocr', $2::jsonb, now() - interval '1 day'
         WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
        [day.imageUrl, config],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const day of days) {
      await queryRunner.query(
        `DELETE FROM crawl_sources WHERE "url" = $1 AND "parser" = 'image-ocr'
         AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
        [day.imageUrl],
      );
    }
  }
}
