import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminCrawl1792500014000 implements MigrationInterface {
  name = 'AdminCrawl1792500014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS crawl_sources (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "festivalId" varchar(32),
      "kind" varchar NOT NULL, "url" varchar NOT NULL, "parser" varchar NOT NULL,
      "parserConfig" jsonb NOT NULL DEFAULT '{}', "intervalMinutes" integer NOT NULL DEFAULT 1440,
      "enabled" boolean NOT NULL DEFAULT true,
      "status" varchar NOT NULL DEFAULT 'ok', "lastRunAt" timestamptz,
      "lastChangedAt" timestamptz, "consecutiveFailures" integer NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS crawl_runs (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "sourceId" uuid NOT NULL REFERENCES crawl_sources("id"),
      "startedAt" timestamptz NOT NULL DEFAULT now(), "finishedAt" timestamptz,
      "result" varchar NOT NULL DEFAULT 'running', "httpStatus" integer,
      "contentHash" varchar, "snapshotUrl" varchar, "error" text,
      "proposalId" uuid, "scheduledDate" date
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_crawl_runs_source_scheduled_date" ON crawl_runs ("sourceId", "scheduledDate") WHERE "scheduledDate" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_crawl_runs_source_running" ON crawl_runs ("sourceId") WHERE "result" = 'running'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crawl_runs_source_started" ON crawl_runs ("sourceId", "startedAt" DESC)`,
    );
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS crawl_proposals (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "festivalId" varchar(32),
      "sourceId" uuid REFERENCES crawl_sources("id"), "runId" uuid REFERENCES crawl_runs("id"),
      "kind" varchar NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(),
      "status" varchar NOT NULL DEFAULT 'open', "confidence" double precision NOT NULL DEFAULT 1,
      "items" jsonb NOT NULL DEFAULT '[]', "evidence" jsonb NOT NULL DEFAULT '{}'
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crawl_proposals_festival_status" ON crawl_proposals ("festivalId", "status")`,
    );
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS crawl_snapshots (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "runId" uuid NOT NULL REFERENCES crawl_runs("id"),
      "objectKey" varchar(100) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "expiresAt" timestamptz NOT NULL
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crawl_snapshots_expires" ON crawl_snapshots ("expiresAt")`,
    );
    // 공개 목록 세 곳을 부팅 직후 한 번 수집하고, 이후 매일 KST 자정에 갱신한다.
    // 멜론은 콘서트 HTML이 빈 목록을 반환하므로 공개 페이지가 사용하는 JSON 주소를 수집한다.
    for (const url of [
      'https://nol.yanolja.com/ticket',
      'https://ticket.melon.com/performance/ajax/prodList.json?commCode=&sortType=HIT&perfGenreCode=GENRE_CON_FESTIVAL&perfThemeCode=&filterCode=FILTER_ALL&v=1',
      'https://ticket.yes24.com/English/Genre/Concert',
    ]) {
      await queryRunner.query(
        `INSERT INTO crawl_sources
          ("kind", "url", "parser", "parserConfig", "createdAt")
         SELECT 'discovery', $1, 'ticket-list', '{}', now() - interval '1 day'
         WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
        [url],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS crawl_snapshots`);
    await queryRunner.query(`DROP TABLE IF EXISTS crawl_proposals`);
    await queryRunner.query(`DROP TABLE IF EXISTS crawl_runs`);
    await queryRunner.query(`DROP TABLE IF EXISTS crawl_sources`);
  }
}
