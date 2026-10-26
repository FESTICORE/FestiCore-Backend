import { MigrationInterface, QueryRunner } from 'typeorm';

const PROFILE_URL =
  'https://poclanos.com/artist/%EC%B6%94%EB%8B%A4%ED%98%9C%EC%B0%A8%EC%A7%80%EC%8A%A4/';
const PORTAL_URL =
  'https://festival.seoul.go.kr/festival/main/festivalView.do?festacode=848';
const CATALOG_URL = 'https://ticket.yes24.com/Perf/60368';

export class SeoulProfileCatalogLink1792500079000 implements MigrationInterface {
  name = 'SeoulProfileCatalogLink1792500079000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources
       SET "parserConfig" = jsonb_set("parserConfig", '{festivalSourceUrl}', to_jsonb($3::text)),
         "updatedAt" = now()
       WHERE kind = 'artist-image' AND url = $1
         AND "parserConfig"->>'seed' = 'festival-official-profile'
         AND "parserConfig"->>'artistName' = '추다해차지스'
         AND "parserConfig"->>'festivalSourceUrl' = $2`,
      [PROFILE_URL, PORTAL_URL, CATALOG_URL],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources
       SET "parserConfig" = jsonb_set("parserConfig", '{festivalSourceUrl}', to_jsonb($3::text)),
         "updatedAt" = now()
       WHERE kind = 'artist-image' AND url = $1
         AND "parserConfig"->>'seed' = 'festival-official-profile'
         AND "parserConfig"->>'artistName' = '추다해차지스'
         AND "parserConfig"->>'festivalSourceUrl' = $2`,
      [PROFILE_URL, CATALOG_URL, PORTAL_URL],
    );
  }
}
