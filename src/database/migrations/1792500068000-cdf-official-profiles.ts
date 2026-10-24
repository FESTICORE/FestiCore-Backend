import { MigrationInterface, QueryRunner } from 'typeorm';

const FESTIVAL_URL = 'https://mintpaper.co.kr/festivals/178';
const profiles = [
  ['https://www.bandkardi.com/profile', 'KARDI', 'bandkardi_'],
  ['https://rbwjapan.jp/artist/onewe.php', 'ONEWE(원위)', 'official_onewe'],
  ['https://www.fncent.com/c/2/9', 'AxMxP', 'axmxp_official'],
  ['https://m.fncent.com/FTISLAND/b/introduce/1281', 'FTISLAND', 'ftisland'],
  ['https://mpmgmusic.com/thesolutions', 'THE SOLUTIONS', 'the_solutions'],
  ['https://ebbmusic.eu/artists/idiotape/', 'IDIOTAPE', 'idiotapeofficial'],
  [
    'https://poclanos.com/artist/%ED%8F%AC%EC%A0%B8%EA%B5%B0%EB%8B%A8/',
    '포져군단',
    'poseridiott',
  ],
  [
    'https://poclanos.com/artist/%EA%B7%B9%EB%8F%99%EC%95%84%EC%8B%9C%EC%95%84%ED%83%80%EC%9D%B4%EA%B1%B0%EC%A6%88/',
    '극동아시아타이거즈',
    'far_east_asian_tigers',
  ],
  [
    'https://poclanos.com/artist/%EC%8B%A4%EB%A6%AC%EC%B9%B4%EA%B2%94/',
    '실리카겔',
    'silicagel.official',
  ],
] as const;

export class CdfOfficialProfiles1792500068000 implements MigrationInterface {
  name = 'CdfOfficialProfiles1792500068000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [url, artistName, officialHandle] of profiles) {
      const conflicts = (await queryRunner.query(
        `SELECT id FROM crawl_sources
         WHERE kind = 'artist-image' AND enabled = true
           AND "parserConfig"->>'festivalSourceUrl' = $1
           AND "parserConfig"->>'seed' IS DISTINCT FROM 'cdf-official-profile'
           AND lower(regexp_replace("parserConfig"->>'artistName', '[[:space:]()]', '', 'g')) =
             lower(regexp_replace($2::text, '[[:space:]()]', '', 'g'))
         LIMIT 1`,
        [FESTIVAL_URL, artistName],
      )) as { id: string }[];
      if (conflicts.length)
        throw new Error(`CDF 공식 프로필과 충돌하는 기존 소스: ${artistName}`);
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
        [url, FESTIVAL_URL, artistName, officialHandle],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [url, artistName] of profiles) {
      await queryRunner.query(
        `DELETE FROM crawl_sources source
         WHERE source.kind = 'artist-image' AND source.url = $1
           AND source."parserConfig"->>'seed' = 'cdf-official-profile'
           AND source."parserConfig"->>'festivalSourceUrl' = $2
           AND source."parserConfig"->>'artistName' = $3
           AND NOT EXISTS (
             SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id
           )`,
        [url, FESTIVAL_URL, artistName],
      );
    }
  }
}
