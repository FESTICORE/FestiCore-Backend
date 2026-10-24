import { discoverySummaries } from './crawl-catalog';
import { PublicFestivalService } from './public-festival.service';

describe('discovered festival timetable', () => {
  const sourceUrl =
    'https://ticket.melon.com/performance/index.htm?prodId=123456';
  const candidate = {
    name: 'Test Festival',
    venue: 'Test Venue',
    date: '2026.10.17 - 2026.10.18',
    url: sourceUrl,
    artists: [{ name: 'Artist A' }],
  };
  const id = discoverySummaries([{ candidate }])[0].id;

  it('keeps the newest verified set when linked sources repeat the same performance', async () => {
    const linked = {
      ...candidate,
      url: 'https://ticket.yes24.com/Perf/60590',
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }, { candidate: linked }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'older-revision',
          sourceUrl: 'https://official.example/older',
          sourceImageId: null,
          verifiedAt: new Date('2026-10-10T00:00:00Z'),
          sets: [
            {
              artist: 'artist a',
              date: '2026-10-17',
              stageName: 'main',
              startsAt: '2026-10-17T11:00:00Z',
              endsAt: null,
            },
          ],
        },
        {
          id: 'newer-revision',
          sourceUrl: 'https://official.example/newer',
          sourceImageId: null,
          verifiedAt: new Date('2026-10-11T00:00:00Z'),
          sets: [
            {
              artist: 'Artist A',
              date: '2026-10-17',
              stageName: 'Main',
              startsAt: '2026-10-17T20:00:00+09:00',
              endsAt: null,
            },
          ],
        },
      ]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    const result = await service.detail(id);
    expect(result.timetable).toEqual([
      expect.objectContaining({ id: 'newer-revision-0' }),
    ]);
    expect((query.mock.calls as [string, string[][]][])[3][1]).toEqual([
      [sourceUrl, linked.url],
    ]);
  });

  it('combines the latest verified revision per source across two days', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'revision-day-2',
          sourceId: 'source-day-2',
          sourceUrl: 'https://official.example/day-2',
          sourceImageId: null,
          verifiedAt: new Date('2026-10-11T00:00:00Z'),
          sets: [
            {
              artist: 'Artist B',
              date: '2026-10-18',
              stageName: 'Main Stage',
              startsAt: '2026-10-18T18:00:00+09:00',
              endsAt: '2026-10-18T19:00:00+09:00',
            },
          ],
        },
        {
          id: 'revision-day-1',
          sourceId: 'source-day-1',
          sourceUrl: 'https://official.example/day-1',
          sourceImageId: '00000000-0000-4000-8000-000000000010',
          verifiedAt: new Date('2026-10-10T00:00:00Z'),
          sets: [
            {
              artist: 'Artist A',
              date: '2026-10-17',
              stageName: 'Main Stage',
              startsAt: '2026-10-17T20:00:00+09:00',
              endsAt: null,
            },
          ],
        },
      ]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    await expect(service.detail(id)).resolves.toMatchObject({
      artists: [
        { name: 'Artist A', imageUrl: null },
        { name: 'Artist B', imageUrl: null },
      ],
      timetable: [
        {
          artist: 'Artist A',
          stageName: 'Main Stage',
          endsAt: null,
          sourceUrl: 'https://official.example/day-1',
          sourceImageUrl:
            '/api/v1/festivals/images/00000000-0000-4000-8000-000000000010.webp',
        },
        {
          artist: 'Artist B',
          date: '2026-10-18',
          sourceUrl: 'https://official.example/day-2',
          sourceImageUrl: null,
        },
      ],
    });
    const [sql, parameters] = query.mock.calls[3] as [string, string[]];
    expect(sql).toContain('DISTINCT ON (revision."sourceId")');
    expect(sql).toContain("revision.status = 'verified'");
    expect(sql).toContain('revision."imageId" = image.id');
    expect(parameters).toEqual([[sourceUrl]]);
  });

  it('retains the prior verified source revision when a newer collection is pending', async () => {
    const priorVerified = {
      id: 'verified-day-1',
      sourceId: 'source-day-1',
      sourceUrl: 'https://official.example/day-1',
      sourceImageId: null,
      verifiedAt: new Date('2026-10-10T00:00:00Z'),
      sets: [
        {
          artist: 'Artist A',
          date: '2026-10-17',
          stageName: 'Main Stage',
          startsAt: '2026-10-17T20:00:00+09:00',
          endsAt: null,
        },
      ],
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      // The DB query's verified predicate excludes the newer pending row.
      .mockResolvedValueOnce([priorVerified]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    await expect(service.detail(id)).resolves.toMatchObject({
      timetable: [{ id: 'verified-day-1-0', artist: 'Artist A' }],
    });
    expect((query.mock.calls[3] as [string])[0]).toContain(
      "revision.status = 'verified'",
    );
  });

  it('keeps the timetable empty while all collected revisions are pending', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    await expect(service.detail(id)).resolves.toMatchObject({ timetable: [] });
  });

  it('uses stored images for timetable-only artists and parenthetical Korean aliases', async () => {
    const imageId = '00000000-0000-4000-8000-000000000020';
    const timetableOnlyCandidate = { ...candidate, artists: [] };
    const timetableOnlyId = discoverySummaries([
      { candidate: timetableOnlyCandidate },
    ])[0].id;
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate: timetableOnlyCandidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { festivalSourceUrl: sourceUrl, artistName: 'NELL (넬)', id: imageId },
      ])
      .mockResolvedValueOnce([
        {
          id: 'revision-1',
          sourceUrl: 'https://official.example/timetable',
          sourceImageId: null,
          verifiedAt: new Date('2026-10-10T00:00:00Z'),
          sets: [
            {
              artist: '넬',
              date: '2026-10-17',
              stageName: 'Main Stage',
              startsAt: '2026-10-17T20:00:00+09:00',
              endsAt: null,
            },
          ],
        },
      ]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    const result = await service.detail(timetableOnlyId);
    const imageUrl = `/api/v1/festivals/images/${imageId}.webp`;
    expect(result.timetable).toEqual([
      expect.objectContaining({ artist: '넬', imageUrl }),
    ]);
    expect(result.artists).toContainEqual({ name: '넬', imageUrl });
  });

  it('keeps ambiguous aliases without an image', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          festivalSourceUrl: sourceUrl,
          artistName: 'A (에이)',
          id: '00000000-0000-4000-8000-000000000021',
        },
        {
          festivalSourceUrl: sourceUrl,
          artistName: 'B (에이)',
          id: '00000000-0000-4000-8000-000000000022',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'revision-1',
          sourceUrl: 'https://official.example/timetable',
          sourceImageId: null,
          verifiedAt: new Date('2026-10-10T00:00:00Z'),
          sets: [
            {
              artist: '에이',
              date: '2026-10-17',
              stageName: 'Main Stage',
              startsAt: '2026-10-17T20:00:00+09:00',
              endsAt: null,
            },
          ],
        },
      ]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    const result = await service.detail(id);
    expect(result.timetable).toEqual([
      expect.objectContaining({ artist: '에이', imageUrl: null }),
    ]);
  });
});
