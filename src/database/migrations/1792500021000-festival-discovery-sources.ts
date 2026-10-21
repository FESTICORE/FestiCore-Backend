import { MigrationInterface, QueryRunner } from 'typeorm';

const OLD_NOL_URL = 'https://nol.yanolja.com/ticket';
const NOL_CONCERT_URL = 'https://nol.yanolja.com/ticket/genre/concert';
const YES24_FESTIVAL_URL =
  'https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx?genre=15464&sort=0&area=&genretype=2&pCurPage=1&pPageSize=30';
const MELON_OLD_URL =
  'https://ticket.melon.com/performance/ajax/prodList.json?commCode=&sortType=HIT&perfGenreCode=GENRE_CON_FESTIVAL&perfThemeCode=&filterCode=FILTER_ALL&v=1';
const MELON_NEW_URL =
  'https://ticket.melon.com/performance/ajax/prodList.json?commCode=&sortType=HIT&perfGenreCode=GENRE_CON_FESTIVAL&perfThemeCode=&filterCode=FILTER_ALL&v=2';

export class FestivalDiscoverySources1792500021000 implements MigrationInterface {
  name = 'FestivalDiscoverySources1792500021000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'discovery', $1::varchar, 'ticket-list', '{}', now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [NOL_CONCERT_URL],
    );
    await queryRunner.query(
      `UPDATE crawl_sources SET "enabled" = false, "status" = 'disabled', "updatedAt" = now()
       WHERE "url" = $1 AND "kind" = 'discovery'
         AND EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $2 AND "kind" = 'discovery')`,
      [OLD_NOL_URL, NOL_CONCERT_URL],
    );
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'discovery', $1::varchar, 'ticket-list', '{}', now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [YES24_FESTIVAL_URL],
    );
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'discovery', $1::varchar, 'ticket-list', '{}', now() - interval '1 day'
       WHERE EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $2 AND "kind" = 'discovery')
         AND NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [MELON_NEW_URL, MELON_OLD_URL],
    );
    await queryRunner.query(
      `UPDATE crawl_sources SET "enabled" = false, "status" = 'disabled', "updatedAt" = now()
       WHERE "url" = $1 AND "kind" = 'discovery'
         AND EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $2 AND "kind" = 'discovery')`,
      [MELON_OLD_URL, MELON_NEW_URL],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources SET "enabled" = true, "status" = 'ok',
         "consecutiveFailures" = 0, "updatedAt" = now()
       WHERE "url" = $1 AND "kind" = 'discovery'`,
      [OLD_NOL_URL],
    );
    for (const url of [NOL_CONCERT_URL, MELON_NEW_URL, YES24_FESTIVAL_URL]) {
      await queryRunner.query(
        `UPDATE crawl_sources SET "enabled" = false, "status" = 'disabled', "updatedAt" = now()
         WHERE "url" = $1 AND "kind" = 'discovery'`,
        [url],
      );
    }
    await queryRunner.query(
      `DELETE FROM crawl_sources WHERE "url" = $1 AND "kind" = 'discovery'
       AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
      [NOL_CONCERT_URL],
    );
    await queryRunner.query(
      `UPDATE crawl_sources SET "enabled" = true, "status" = 'ok',
         "consecutiveFailures" = 0, "updatedAt" = now()
       WHERE "url" = $1 AND "kind" = 'discovery'`,
      [MELON_OLD_URL],
    );
    await queryRunner.query(
      `DELETE FROM crawl_sources WHERE "url" = $1 AND "kind" = 'discovery'
       AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
      [MELON_NEW_URL],
    );
    await queryRunner.query(
      `DELETE FROM crawl_sources WHERE "url" = $1 AND "kind" = 'discovery'
       AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
      [YES24_FESTIVAL_URL],
    );
  }
}
