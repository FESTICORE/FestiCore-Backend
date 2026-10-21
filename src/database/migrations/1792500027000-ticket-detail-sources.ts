import { MigrationInterface, QueryRunner } from 'typeorm';

const WONDERLIVET_DETAIL =
  'https://ticket.melon.com/performance/index.htm?prodId=213793';

export class TicketDetailSources1792500027000 implements MigrationInterface {
  name = 'TicketDetailSources1792500027000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources SET "enabled" = false, "status" = 'disabled', "updatedAt" = now()
       WHERE "kind" = 'discovery' AND "url" IN (
         'https://nol.yanolja.com/ticket',
         'https://nol.yanolja.com/ticket/genre/concert'
       )`,
    );
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'discovery', $1::varchar, 'ticket-list', '{"seed":"ticket-detail"}', now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [WONDERLIVET_DETAIL],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources SET "enabled" = true, "status" = 'ok', "updatedAt" = now()
       WHERE "kind" = 'discovery' AND "url" = 'https://nol.yanolja.com/ticket/genre/concert'`,
    );
    await queryRunner.query(
      `DELETE FROM crawl_sources WHERE "url" = $1 AND "kind" = 'discovery'
       AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
      [WONDERLIVET_DETAIL],
    );
  }
}
