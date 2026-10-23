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
