import { MigrationInterface, QueryRunner } from 'typeorm';

const IMAGE_URL =
  'https://seoulmusicfestival.co.kr/data/editor/2610/20261013144109_01.png';
const FESTIVAL_SOURCE_URL =
  'https://festival.seoul.go.kr/festival/main/festivalView.do?festacode=848';
const SOURCE_PAGE_URL =
  'https://www.seoulmusicfestival.co.kr/2026/community/notice_view.php?seq=43';

// The middle card is a talk show. Each rectangle covers only the text area
// of one performance card in the 500 x 625 official image.
const columns = JSON.stringify([
  {
    stageId: 'stg_seoul_busking_first',
    stageName: '버스킹 무대',
    left: 0.44,
    top: 0.2,
    width: 0.5,
    height: 0.2,
    artistPosition: 'after',
  },
  {
    stageId: 'stg_seoul_busking_third',
    stageName: '버스킹 무대',
    left: 0.44,
    top: 0.71,
    width: 0.5,
    height: 0.2,
    artistPosition: 'after',
  },
]);

export class SeoulBuskingTimetable1792500062000 implements MigrationInterface {
  name = 'SeoulBuskingTimetable1792500062000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const config = JSON.stringify({
      festivalSourceUrl: FESTIVAL_SOURCE_URL,
      sourcePageUrl: SOURCE_PAGE_URL,
      date: '2026-10-24',
      expectedRows: '2',
      publicSourceImage: false,
      columns,
    });
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'timetable', $1::varchar, 'image-ocr', $2::jsonb, now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [IMAGE_URL, config],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources WHERE "url" = $1 AND "parser" = 'image-ocr'
       AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
      [IMAGE_URL],
    );
  }
}
