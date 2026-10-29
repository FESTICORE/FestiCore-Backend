import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  COMMONS_DISCOVERY_SEED,
  COMMONS_DISCOVERY_URL,
} from '../../modules/admin/crawl/service/commons-image-discovery';

export class CommonsImageDiscovery1792500093000 implements MigrationInterface {
  name = 'CommonsImageDiscovery1792500093000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE crawl_runs ADD COLUMN "artistImageEvidence" jsonb',
    );
    const existing = (await queryRunner.query(
      `SELECT id FROM crawl_sources WHERE kind = 'artist-image-discovery'
       AND (url IS DISTINCT FROM $1::text
         OR parser IS DISTINCT FROM 'commons-search'
         OR "parserConfig" IS DISTINCT FROM jsonb_build_object('seed', $2::text)
         OR "festivalId" IS NOT NULL)
       LIMIT 1`,
      [COMMONS_DISCOVERY_URL, COMMONS_DISCOVERY_SEED],
    )) as { id: string }[];
    if (existing.length) throw new Error('Commons 탐색 소스 설정 충돌');
    await queryRunner.query(
      `INSERT INTO crawl_sources
         (kind, url, parser, "parserConfig", "intervalMinutes", "createdAt")
       SELECT 'artist-image-discovery', $1::text, 'commons-search',
         jsonb_build_object('seed', $2::text), 1440, now() - interval '1 day'
       WHERE NOT EXISTS (
         SELECT 1 FROM crawl_sources WHERE kind = 'artist-image-discovery'
       )`,
      [COMMONS_DISCOVERY_URL, COMMONS_DISCOVERY_SEED],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources source
       WHERE source.kind = 'artist-image-discovery'
         AND source.url = $1::text
         AND source."parserConfig"->>'seed' = $2::text
         AND NOT EXISTS (SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id)`,
      [COMMONS_DISCOVERY_URL, COMMONS_DISCOVERY_SEED],
    );
    await queryRunner.query(
      'ALTER TABLE crawl_runs DROP COLUMN "artistImageEvidence"',
    );
  }
}
