import { MigrationInterface, QueryRunner } from 'typeorm';

const ENGLISH_CONCERTS = 'https://ticket.yes24.com/English/Genre/Concert';

/**
 * The first KST crawl of this source finished before the English festival
 * poster parser was deployed. Keep its history but release today's scheduling
 * key once if either known poster is still absent. The ordinary scheduler then
 * retries on startup; no image is inserted without the normal fetch checks.
 */
export class Yes24EnglishPosterRetry1792500037000 implements MigrationInterface {
  name = 'Yes24EnglishPosterRetry1792500037000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_runs AS run SET "scheduledDate" = NULL
       FROM crawl_sources AS source
       WHERE source.id = run."sourceId"
         AND source.url = $1
         AND source.enabled = true
         AND source.status = 'ok'
         AND run."scheduledDate" = (now() AT TIME ZONE 'Asia/Seoul')::date
         AND run.result <> 'running'
         AND NOT EXISTS (
           SELECT 1 FROM crawl_runs AS active
           WHERE active."sourceId" = source.id AND active.result = 'running'
         )
         AND (
           NOT EXISTS (
             SELECT 1 FROM crawl_images AS image
             WHERE image."sourceId" = source.id
               AND image."originUrl" ~ '-60590[.](jpe?g|png|webp)$'
           )
           OR NOT EXISTS (
             SELECT 1 FROM crawl_images AS image
             WHERE image."sourceId" = source.id
               AND image."originUrl" ~ '-54606[.](jpe?g|png|webp)$'
           )
         )`,
      [ENGLISH_CONCERTS],
    );
  }

  async down(): Promise<void> {
    // A completed retry is historical crawl data and cannot be undone safely.
  }
}
