import { MigrationInterface, QueryRunner } from 'typeorm';

const IMAGE_URL =
  'https://img.tf.co.kr/article/home/2026/09/30/202629801790731702.jpg';
const FESTIVAL_SOURCE_URL =
  'https://ticket.melon.com/performance/index.htm?prodId=213793';
const SOURCE_PAGE_URL = 'https://news.tf.co.kr/read/entertain/2371151.htm';

const days = [
  { date: '2026-11-20', left: 0.035, width: 0.285 },
  { date: '2026-11-21', left: 0.36, width: 0.285 },
  { date: '2026-11-22', left: 0.685, width: 0.28 },
];

export class WonderlivetTimetableSources1792500047000 implements MigrationInterface {
  name = 'WonderlivetTimetableSources1792500047000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const day of days) {
      // The poster has alternating stage cards in each day column. OCR may
      // locate artists and times, but an admin must assign the actual stage.
      const columns = JSON.stringify([
        {
          stageId: 'stg_wonderlivet_review',
          stageName: '무대 확인 필요',
          left: day.left,
          top: 0.25,
          width: day.width,
          height: 0.72,
        },
      ]);
      const config = JSON.stringify({
        festivalSourceUrl: FESTIVAL_SOURCE_URL,
        sourcePageUrl: SOURCE_PAGE_URL,
        date: day.date,
        expectedRows: '14',
        allowedStageNames: ['WONDER STAGE', 'LIVET STAGE'],
        columns,
      });
      const url = `${IMAGE_URL}?day=${day.date}`;
      await queryRunner.query(
        `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
         SELECT 'timetable', $1::varchar, 'image-ocr', $2::jsonb, now() - interval '1 day'
         WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
        [url, config],
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
        [`${IMAGE_URL}?day=${day.date}`],
      );
    }
  }
}
