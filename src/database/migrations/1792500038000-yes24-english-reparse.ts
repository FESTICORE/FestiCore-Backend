import { MigrationInterface, QueryRunner } from 'typeorm';

/** Re-run the English listing once with the new parser content hash. */
export class Yes24EnglishReparse1792500038000 implements MigrationInterface {
  name = 'Yes24EnglishReparse1792500038000';

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
         )`,
      ['https://ticket.yes24.com/English/Genre/Concert'],
    );
  }

  async down(): Promise<void> {
    // A completed crawl retry is historical data.
  }
}
