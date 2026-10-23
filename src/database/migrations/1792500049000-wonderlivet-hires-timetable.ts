import { MigrationInterface, QueryRunner } from 'typeorm';

const OLD_IMAGE =
  'https://img.tf.co.kr/article/home/2026/09/30/202629801790731702.jpg';
const NEW_IMAGE =
  'https://talkimg.imbc.com/TVianUpload/tvian/TViews/image/2026/09/30/32bdd8f0-e012-4dd7-bbe9-00e7116dd218.jpg';
const SOURCE_PAGE = 'https://enews.imbc.com/News/RetrieveNewsInfo/519624';
const DAYS = ['2026-11-20', '2026-11-21', '2026-11-22'];

export class WonderlivetHiresTimetable1792500049000 implements MigrationInterface {
  name = 'WonderlivetHiresTimetable1792500049000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const day of DAYS) {
      const oldUrl = `${OLD_IMAGE}?day=${day}`;
      const newUrl = `${NEW_IMAGE}?day=${day}`;
      const collision: unknown = await queryRunner.query(
        `SELECT id FROM crawl_sources WHERE "url" = $2
         AND EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1 AND "parser" = 'image-ocr')
         LIMIT 1`,
        [oldUrl, newUrl],
      );
      if (Array.isArray(collision) && collision.length)
        throw new Error(
          '원더리벳 고해상도 시간표 소스가 이미 등록되어 있습니다.',
        );
      const updated: unknown = await queryRunner.query(
        `UPDATE crawl_sources SET "url" = $2,
           "parserConfig" = jsonb_set("parserConfig", '{sourcePageUrl}', to_jsonb($3::text)),
           "createdAt" = now() - interval '1 day', "consecutiveFailures" = 0,
           "status" = CASE WHEN "enabled" THEN 'ok' ELSE "status" END,
           "updatedAt" = now()
         WHERE "url" = $1 AND "parser" = 'image-ocr'
         RETURNING id`,
        [oldUrl, newUrl, SOURCE_PAGE],
      );
      if (!Array.isArray(updated) || updated.length !== 1)
        throw new Error(
          `원더리벳 ${day} 고해상도 시간표 소스를 교체하지 못했습니다.`,
        );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const day of DAYS) {
      const restored: unknown = await queryRunner.query(
        `UPDATE crawl_sources SET "url" = $1,
           "parserConfig" = jsonb_set("parserConfig", '{sourcePageUrl}', to_jsonb($3::text)),
           "updatedAt" = now()
         WHERE "url" = $2 AND "parser" = 'image-ocr'
           AND NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)
         RETURNING id`,
        [
          `${OLD_IMAGE}?day=${day}`,
          `${NEW_IMAGE}?day=${day}`,
          'https://news.tf.co.kr/read/entertain/2371151.htm',
        ],
      );
      if (!Array.isArray(restored) || restored.length !== 1)
        throw new Error(`원더리벳 ${day} 시간표 소스를 복원하지 못했습니다.`);
    }
  }
}
