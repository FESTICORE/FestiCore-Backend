import { MigrationInterface, QueryRunner } from 'typeorm';

const FESTIVAL_URL = 'https://mintpaper.co.kr/festivals/178';
const OLD_URL = 'https://rbwjapan.jp/artist/onewe.php';
const NEW_URL = 'https://oneweofficial.jp/profile';
const ARTIST = 'ONEWE(원위)';
const HANDLE = 'official_onewe';

export class OneweOfficialProfile1792500074000 implements MigrationInterface {
  name = 'OneweOfficialProfile1792500074000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const conflicts = (await queryRunner.query(
      `SELECT id FROM crawl_sources
       WHERE kind = 'artist-image' AND enabled = true
         AND "parserConfig"->>'festivalSourceUrl' = $1
         AND "parserConfig"->>'seed' IS DISTINCT FROM 'cdf-official-profile'
         AND lower(regexp_replace("parserConfig"->>'artistName', '[[:space:]()]', '', 'g')) =
           lower(regexp_replace($2::text, '[[:space:]()]', '', 'g'))
       LIMIT 1`,
      [FESTIVAL_URL, ARTIST],
    )) as { id: string }[];
    if (conflicts.length)
      throw new Error(`CDF 공식 프로필과 충돌하는 기존 소스: ${ARTIST}`);

    await queryRunner.query(
      `UPDATE crawl_sources SET url = $1::text, "updatedAt" = now()
       WHERE kind = 'artist-image' AND url = $2::text
         AND "parserConfig"->>'seed' = 'cdf-official-profile'
         AND "parserConfig"->>'festivalSourceUrl' = $3::text
         AND "parserConfig"->>'artistName' = $4::text
         AND "parserConfig"->>'officialHandle' = $5::text
         AND NOT EXISTS (
           SELECT 1 FROM crawl_sources existing
           WHERE existing.kind = 'artist-image' AND existing.url = $1::text
             AND existing."parserConfig"->>'festivalSourceUrl' = $3::text
             AND existing."parserConfig"->>'artistName' = $4::text
         )`,
      [NEW_URL, OLD_URL, FESTIVAL_URL, ARTIST, HANDLE],
    );
    await queryRunner.query(
      `INSERT INTO crawl_sources
         (kind, url, parser, "parserConfig", "intervalMinutes", "createdAt")
       SELECT 'artist-image', $1::text, 'html-text',
         jsonb_build_object('seed', 'cdf-official-profile',
           'festivalSourceUrl', $2::text, 'artistName', $3::text,
           'officialHandle', $4::text),
         1440, now() - interval '1 day'
       WHERE NOT EXISTS (
         SELECT 1 FROM crawl_sources
         WHERE kind = 'artist-image' AND url = $1::text
           AND "parserConfig"->>'festivalSourceUrl' = $2::text
           AND "parserConfig"->>'artistName' = $3::text
       )`,
      [NEW_URL, FESTIVAL_URL, ARTIST, HANDLE],
    );
  }

  down(): Promise<void> {
    // 기존 행의 전환과 새 행 삽입을 구분할 수 없어 자동 롤백을 차단한다.
    return Promise.reject(
      new Error(
        'ONEWE 공식 프로필 소스는 수집 이력을 확인한 뒤 수동으로 되돌려야 합니다.',
      ),
    );
  }
}
