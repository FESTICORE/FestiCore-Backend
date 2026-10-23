import { MigrationInterface, QueryRunner } from 'typeorm';

const OLD_IMAGE =
  'https://talkimg.imbc.com/TVianUpload/tvian/TViews/image/2026/09/30/32bdd8f0-e012-4dd7-bbe9-00e7116dd218.jpg?day=2026-11-20';
const NEW_IMAGE =
  'https://apologies.jp/static/amazarashi/contents/information/a9feba10c91fe857e6b377d869ec48d2.jpg';
const OLD_PAGE = 'https://enews.imbc.com/News/RetrieveNewsInfo/519624';
const NEW_PAGE = 'https://apologies.jp/news/detail/811';

const officialColumn = JSON.stringify([
  {
    stageId: 'stg_wonderlivet_review',
    stageName: '무대 확인 필요',
    left: 0.075,
    top: 0.255,
    width: 0.78,
    height: 0.65,
    artistPosition: 'after',
  },
]);
const previousColumn = JSON.stringify([
  {
    stageId: 'stg_wonderlivet_review',
    stageName: '무대 확인 필요',
    left: 0.035,
    top: 0.25,
    width: 0.285,
    height: 0.72,
  },
]);

export class WonderlivetOfficialFriday1792500051000 implements MigrationInterface {
  name = 'WonderlivetOfficialFriday1792500051000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const updated = (await queryRunner.query(
      `UPDATE crawl_sources SET "url" = $2,
         "parserConfig" = jsonb_set(
           jsonb_set("parserConfig", '{sourcePageUrl}', to_jsonb($3::text)),
           '{columns}', to_jsonb($4::text)
         ),
         "createdAt" = now() - interval '1 day', "consecutiveFailures" = 0,
         "updatedAt" = now()
       WHERE "url" = $1 AND "parser" = 'image-ocr'
         AND NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $2)
       RETURNING id`,
      [OLD_IMAGE, NEW_IMAGE, NEW_PAGE, officialColumn],
      true,
    )) as { affected?: number };
    if (updated.affected !== 1)
      throw new Error(
        '원더리벳 금요일 공식 시간표 소스를 교체하지 못했습니다.',
      );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const restored = (await queryRunner.query(
      `UPDATE crawl_sources SET "url" = $1,
         "parserConfig" = jsonb_set(
           jsonb_set("parserConfig", '{sourcePageUrl}', to_jsonb($3::text)),
           '{columns}', to_jsonb($4::text)
         ), "updatedAt" = now()
       WHERE "url" = $2 AND "parser" = 'image-ocr'
         AND NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)
       RETURNING id`,
      [OLD_IMAGE, NEW_IMAGE, OLD_PAGE, previousColumn],
      true,
    )) as { affected?: number };
    if (restored.affected !== 1)
      throw new Error('원더리벳 금요일 시간표 소스를 복원하지 못했습니다.');
  }
}
