import sharp from 'sharp';
import { festivalSetId } from './festival-set-id';
import {
  parseTimetableOcr,
  TimetableImageService,
} from './timetable-image.service';

const festival = {
  days: [
    {
      date: '2026-10-24',
      startsAt: '2026-10-24T12:00:00+09:00',
      endsAt: '2026-10-24T23:00:00+09:00',
    },
  ],
  stages: [{ id: 'stg_main', name: 'MAIN' }],
};

function tsv(lines: { words: string[]; confidence?: number }[]) {
  const header =
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  return [
    header,
    ...lines.flatMap((line, index) =>
      line.words.map(
        (word, wordIndex) =>
          `5\t1\t1\t1\t${index + 1}\t${wordIndex + 1}\t0\t0\t20\t10\t${line.confidence ?? 92}\t${word}`,
      ),
    ),
  ].join('\n');
}

describe('timetable image OCR preview', () => {
  it('returns only complete, confident Set rows and never invents missing values', () => {
    const result = parseTimetableOcr(
      tsv([
        { words: ['MAIN', '13:00-14:00', '가수'] },
        { words: ['15:00-16:00', '무대없음'] },
        { words: ['MAIN', '17:00-18:00', '불확실'], confidence: 40 },
        { words: ['MAIN', '21:00-23:30', '범위밖'] },
      ]),
      '2026-10-24',
      festival,
    );
    expect(result).toEqual({
      draft: [
        {
          id: festivalSetId({
            stageId: 'stg_main',
            artist: '가수',
            startsAt: '2026-10-24T13:00:00+09:00',
            endsAt: '2026-10-24T14:00:00+09:00',
          }),
          stageId: 'stg_main',
          artist: '가수',
          startsAt: '2026-10-24T13:00:00+09:00',
          endsAt: '2026-10-24T14:00:00+09:00',
          note: null,
        },
      ],
      confidence: 0.92,
      unparsed: [
        '15:00-16:00 무대없음',
        'MAIN 17:00-18:00 불확실',
        'MAIN 21:00-23:30 범위밖',
      ],
    });
  });

  it('rejects dates outside festival days', () => {
    expect(() => parseTimetableOcr(tsv([]), '2026-10-25', festival)).toThrow();
  });

  it('does not mistake an artist containing a stage name for the stage', () => {
    const result = parseTimetableOcr(
      tsv([{ words: ['MAIN', 'STREET', '13:00-14:00'] }]),
      '2026-10-24',
      festival,
    );
    expect(result.draft).toEqual([]);
    expect(result.unparsed).toEqual(['MAIN STREET 13:00-14:00']);
  });

  it('supports a festival day ending after midnight', () => {
    const overnight = {
      ...festival,
      days: [
        {
          date: '2026-10-24',
          startsAt: '2026-10-24T18:00:00+09:00',
          endsAt: '2026-10-25T02:00:00+09:00',
        },
      ],
    };
    const result = parseTimetableOcr(
      tsv([
        { words: ['MAIN', '23:00-00:30', '야간가수'] },
        { words: ['MAIN', '00:30-01:00', '새벽가수'] },
        { words: ['MAIN', '02:00-03:00', '범위밖'] },
      ]),
      '2026-10-24',
      overnight,
    );
    expect(result.draft).toEqual([
      expect.objectContaining({
        startsAt: '2026-10-24T23:00:00+09:00',
        endsAt: '2026-10-25T00:30:00+09:00',
      }),
      expect.objectContaining({
        startsAt: '2026-10-25T00:30:00+09:00',
        endsAt: '2026-10-25T01:00:00+09:00',
      }),
    ]);
    expect(result.unparsed).toEqual(['MAIN 02:00-03:00 범위밖']);
  });

  it('puts overlapping same-stage rows and rows after 400 into unparsed', () => {
    const overlap = parseTimetableOcr(
      tsv([
        { words: ['MAIN', '13:00-14:00', '가수1'] },
        { words: ['MAIN', '13:30-14:30', '가수2'] },
      ]),
      '2026-10-24',
      festival,
    );
    expect(overlap.draft).toHaveLength(1);
    expect(overlap.unparsed).toEqual(['MAIN 13:30-14:30 가수2']);

    const clock = (minutes: number) =>
      `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const rows = Array.from({ length: 401 }, (_, index) => ({
      words: [
        'MAIN',
        `${clock(12 * 60 + index)}-${clock(12 * 60 + index + 1)}`,
        `가수${index}`,
      ],
    }));
    const capped = parseTimetableOcr(tsv(rows), '2026-10-24', festival);
    expect(capped.draft).toHaveLength(400);
    expect(capped.unparsed).toEqual(['MAIN 18:40-18:41 가수400']);
  });

  it('validates file bytes, MIME, calendar date and image decoding before OCR', async () => {
    const service = new TimetableImageService();
    const valid = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    await expect(
      service.preview(valid, 'image/png', '2026-02-30', festival),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.preview(valid, 'image/png', '2026-10-25', festival),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.preview(valid, 'text/plain', '2026-10-24', festival),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      service.preview(
        Buffer.alloc(10 * 1024 * 1024 + 1),
        'image/png',
        '2026-10-24',
        festival,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      service.preview(
        Buffer.from('not an image'),
        'image/png',
        '2026-10-24',
        festival,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
