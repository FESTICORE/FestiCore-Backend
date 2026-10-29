import sharp from 'sharp';
import {
  extractTimetableImageCandidates,
  parseStageTsv,
} from './timetable-image-ocr';

const header =
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const word = (line: number, order: number, top: number, text: string) =>
  `5\t1\t1\t1\t${line}\t${order}\t${order * 80}\t${top}\t60\t18\t95\t${text}`;

describe('timetable image OCR candidates', () => {
  it('keeps times and evidence within their own stage column', async () => {
    const image = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: 'white',
      },
    })
      .png()
      .toBuffer();
    const runner = jest
      .fn()
      .mockResolvedValueOnce(
        [
          header,
          word(1, 1, 20, 'Band A'),
          word(2, 1, 55, '12:20'),
          word(2, 2, 55, '-'),
          word(2, 3, 55, '13:00'),
        ].join('\n'),
      )
      .mockResolvedValueOnce(
        [header, word(1, 1, 20, 'Band B'), word(2, 1, 55, '14:20')].join('\n'),
      );
    const rows = await extractTimetableImageCandidates(
      image,
      {
        date: '2026-10-17',
        columns: [
          { stageId: 'stg_mint', left: 0, top: 0, width: 0.5, height: 1 },
          { stageId: 'stg_club', left: 0.5, top: 0, width: 0.5, height: 1 },
        ],
      },
      runner,
    );
    expect(rows).toEqual([
      {
        stageId: 'stg_mint',
        startsAt: '2026-10-17T12:20:00+09:00',
        endsAt: '2026-10-17T13:00:00+09:00',
        artistText: 'Band A',
        rawText: '12:20 - 13:00',
      },
      {
        stageId: 'stg_club',
        startsAt: '2026-10-17T14:20:00+09:00',
        endsAt: null,
        artistText: 'Band B',
        rawText: '14:20',
      },
    ]);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('drops reversed times and does not invent an end time', () => {
    expect(
      parseStageTsv(
        [
          header,
          word(1, 1, 10, 'Artist'),
          word(2, 1, 40, '14:00'),
          word(2, 2, 40, '-'),
          word(2, 3, 40, '13:00'),
          word(3, 1, 80, 'Headliner'),
          word(4, 1, 110, '20:20'),
        ].join('\n'),
        '2026-10-17',
        'stg_mint',
      ),
    ).toEqual([
      expect.objectContaining({
        startsAt: '2026-10-17T20:20:00+09:00',
        endsAt: null,
      }),
    ]);
  });

  it('reads an artist after a printed start tick only when configured', () => {
    const tsv = [
      header,
      word(1, 1, 20, '12:00'),
      word(1, 2, 20, 'A I W E O'),
      word(2, 1, 70, '12:30'),
      word(3, 1, 88, 'nishina'),
      word(4, 1, 130, '13:00'),
      word(5, 1, 148, 'Conton Candy'),
    ].join('\n');
    expect(parseStageTsv(tsv, '2026-11-20', 'stg_review', 'after')).toEqual([
      expect.objectContaining({
        startsAt: '2026-11-20T12:00:00+09:00',
        artistText: 'A I W E O',
      }),
      expect.objectContaining({
        startsAt: '2026-11-20T12:30:00+09:00',
        artistText: 'nishina',
      }),
      expect.objectContaining({
        startsAt: '2026-11-20T13:00:00+09:00',
        artistText: 'Conton Candy',
        endsAt: null,
      }),
    ]);
  });

  it('uses the next artist line after a bracketed time range without its description', () => {
    const tsv = [
      header,
      word(1, 1, 17, '공연'),
      word(1, 2, 17, '(13:30~14:00)'),
      word(2, 1, 92, '쓰'),
      word(2, 2, 92, '다'),
      word(3, 1, 138, '싱어송라이터'),
      word(3, 2, 138, '소개'),
    ].join('\n');
    expect(parseStageTsv(tsv, '2026-10-24', 'stg_busking', 'after')).toEqual([
      expect.objectContaining({
        startsAt: '2026-10-24T13:30:00+09:00',
        endsAt: '2026-10-24T14:00:00+09:00',
        artistText: '쓰 다',
      }),
    ]);
  });

  it('keeps two artist lines after a time-only tick', () => {
    const tsv = [
      header,
      word(1, 1, 20, '12:00'),
      word(2, 1, 70, '첫 번째 출연진'),
      word(3, 1, 100, '두 번째 출연진'),
    ].join('\n');
    expect(parseStageTsv(tsv, '2026-11-20', 'stg_review', 'after')).toEqual([
      expect.objectContaining({
        artistText: '첫 번째 출연진 / 두 번째 출연진',
      }),
    ]);
  });

  it('rejects unsafe image and region configuration', async () => {
    const image = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: 'white',
      },
    })
      .png()
      .toBuffer();
    const config = {
      date: '2026-10-17',
      columns: [
        { stageId: 'stg_mint', left: 0, top: 0, width: 0.5, height: 1 },
      ],
    };
    await expect(
      extractTimetableImageCandidates(image, {
        ...config,
        date: '2026-02-30',
      }),
    ).rejects.toThrow('날짜');
    await expect(
      extractTimetableImageCandidates(image, {
        ...config,
        columns: [{ ...config.columns[0], left: 0.8 }],
      }),
    ).rejects.toThrow('영역');
    await expect(
      extractTimetableImageCandidates(Buffer.alloc(0), config),
    ).rejects.toThrow('이미지');
  });
});
