import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  COMMONS_DISCOVERY_URL,
  COMMONS_PINNED_DISCOVERY_SEED,
} from '../../modules/admin/crawl/service/commons-image-discovery';

// 관리자 지정 Commons 탐색 전용 소스를 만든다. 예약 실행에서는 건너뛴다.
export class CommonsPinnedDiscoverySource1792500108000 implements MigrationInterface {
  name = 'CommonsPinnedDiscoverySource1792500108000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources
         (kind, url, parser, "parserConfig", "intervalMinutes", "createdAt")
       SELECT 'artist-image-discovery', $1::text, 'commons-search',
         jsonb_build_object('seed', $2::text), 1440, now()
       WHERE NOT EXISTS (
         SELECT 1 FROM crawl_sources
         WHERE kind = 'artist-image-discovery'
           AND "parserConfig"->>'seed' = $2::text
       )`,
      [COMMONS_DISCOVERY_URL, COMMONS_PINNED_DISCOVERY_SEED],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources source
       WHERE source.kind = 'artist-image-discovery'
         AND source."parserConfig"->>'seed' = $1::text
         AND NOT EXISTS (SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id)`,
      [COMMONS_PINNED_DISCOVERY_SEED],
    );
  }
}
