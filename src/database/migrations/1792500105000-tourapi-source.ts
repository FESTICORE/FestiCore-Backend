import { MigrationInterface, QueryRunner } from 'typeorm';

const SOURCE = 'https://apis.data.go.kr/B551011/KorService2/searchFestival2';

export class TourApiSource1792500105000 implements MigrationInterface {
  name = 'TourApiSource1792500105000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "enabled", "status", "createdAt")
       SELECT 'discovery', $1::varchar, 'ticket-list', '{"provider":"tourapi"}', false, 'disabled', now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [SOURCE],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources SET "enabled" = false, "status" = 'disabled', "updatedAt" = now()
       WHERE "url" = $1 AND "kind" = 'discovery'`,
      [SOURCE],
    );
  }
}
