import sharp from 'sharp';
import { QueryRunner } from 'typeorm';
import { extractTimetableImageCandidates } from '../../modules/admin/crawl/service/timetable-image-ocr';
import { timetableSourceConfig } from '../../modules/admin/crawl/service/timetable-source-config';
import { SeoulBuskingTimetable1792500062000 } from './1792500062000-seoul-busking-timetable';

const header =
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const word = (line: number, order: number, top: number, value: string) =>
  `5\t1\t1\t1\t${line}\t${order}\t${order * 80}\t${top}\t60\t18\t95\t${value}`;

describe('Seoul busking timetable source', () => {
  it('registers two isolated performance crops and excludes the talk-show card', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new SeoulBuskingTimetable1792500062000().up({
      query,
    } as unknown as QueryRunner);

    const [sql, params] = query.mock.calls[0] as [string, string[]];
    expect(sql).toContain("SELECT 'timetable', $1::varchar, 'image-ocr'");
    expect(params[0]).toBe(
      'https://seoulmusicfestival.co.kr/data/editor/2610/20261013144109_01.png',
    );
    const raw = JSON.parse(params[1]) as Record<string, string>;
    expect(raw).toMatchObject({
      festivalSourceUrl:
        'https://festival.seoul.go.kr/festival/main/festivalView.do?festacode=848',
      sourcePageUrl:
        'https://www.seoulmusicfestival.co.kr/2026/community/notice_view.php?seq=43',
      date: '2026-10-24',
      expectedRows: '2',
      publicSourceImage: false,
    });
    const config = timetableSourceConfig(raw);
    expect(config.columns).toHaveLength(2);
    expect(config.columns.map((column) => column.stageName)).toEqual([
      '버스킹 무대',
      '버스킹 무대',
    ]);
    expect(new Set(config.columns.map((column) => column.stageId)).size).toBe(
      2,
    );
    // The middle card spans roughly 44–66% of the official image height.
    expect(config.columns[0].top + config.columns[0].height).toBeLessThan(0.44);
    expect(config.columns[1].top).toBeGreaterThan(0.66);

    const image = await sharp({
      create: {
        width: 500,
        height: 625,
        channels: 3,
        background: 'white',
      },
    })
      .png()
      .toBuffer();
    const runner = jest
      .fn()
      .mockResolvedValueOnce(
        [header, word(1, 1, 20, '13:30'), word(1, 2, 20, 'ActA')].join('\n'),
      )
      .mockResolvedValueOnce(
        [header, word(1, 1, 20, '15:00'), word(1, 2, 20, 'ActB')].join('\n'),
      );
    const candidates = await extractTimetableImageCandidates(
      image,
      config,
      runner,
    );
    expect(runner).toHaveBeenCalledTimes(2);
    expect(candidates).toEqual([
      expect.objectContaining({
        stageId: config.columns[0].stageId,
        startsAt: '2026-10-24T13:30:00+09:00',
        artistText: 'ActA',
      }),
      expect.objectContaining({
        stageId: config.columns[1].stageId,
        startsAt: '2026-10-24T15:00:00+09:00',
        artistText: 'ActB',
      }),
    ]);
  });
});
