import { publicFestivalTestDataSource } from '../../../test/public-festival-test-data-source';
import { PublicFestivalService } from './public-festival.service';

describe('PublicFestivalService list artistNames', () => {
  const now = new Date('2026-10-22T00:00:00Z');

  function setup(published: object[], discovered: object[] = []) {
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(published),
    };
    const service = new PublicFestivalService(
      { createQueryBuilder: () => builder } as never,
      {} as never,
      publicFestivalTestDataSource(jest.fn().mockResolvedValue([])) as never,
      {} as never,
    );
    const internals = service as unknown as {
      discoveryCatalog: () => Promise<object[]>;
      attachStoredImages: () => Promise<unknown>;
    };
    jest.spyOn(internals, 'discoveryCatalog').mockResolvedValue(discovered);
    jest.spyOn(internals, 'attachStoredImages').mockResolvedValue(new Map());
    return Object.assign(service, { testBuilder: builder });
  }

  it('lists date-only published metadata and uses the same Seoul midnight in cursors', async () => {
    const rows = ['fst_a', 'fst_b'].map((id) => ({
      id,
      publishedVersion: 1,
      published: {
        id,
        name: 'Metadata',
        venue: 'Venue',
        days: [],
        sets: [],
        stages: [],
        eventPeriod: { firstDate: '2026-11-19', lastDate: '2026-11-20' },
        timetableStatus: 'unpublished',
        artists: [{ name: '밴드' }],
      },
    }));
    const service = setup(rows);
    const page = await service.list(undefined, '1', now);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'fst_a',
      firstDate: '2026-11-19',
      lastDate: '2026-11-20',
      packVersion: 1,
      artists: [{ name: '밴드', performances: [] }],
    });
    expect(page.items[0]).not.toHaveProperty('startsAt');
    expect(page.nextCursor).toContain('2026-11-19T00:00:00+09:00~fst_a');
    expect(service.testBuilder.orderBy).toHaveBeenCalledWith(
      expect.stringContaining("'T00:00:00+09:00')::timestamptz"),
      'ASC',
    );
    service.testBuilder.getMany.mockResolvedValue(rows.slice(1));
    const next = await service.list(page.nextCursor!, '1', now);
    expect(next.items.map((item) => item.id)).toEqual(['fst_b']);
    expect(service.testBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('festival.id > :cursorId'),
      { cursorAt: '2026-11-19T00:00:00+09:00', cursorId: 'fst_a' },
    );
  });

  it('lists distinct published set artists in timetable order', async () => {
    const service = setup([
      {
        id: 'fst_pub',
        publishedVersion: 2,
        published: {
          id: 'fst_pub',
          name: '발행 축제',
          venue: '공연장',
          days: [{ date: '2026-11-19', startsAt: '2026-11-19T13:00:00+09:00' }],
          sets: [
            { artist: ' 노이즈캔디 ', startsAt: '2026-11-19T13:00:00+09:00' },
            { artist: '삼보마스터', startsAt: '2026-11-19T14:00:00+09:00' },
            { artist: '노이즈캔디', startsAt: '2026-11-19T15:00:00+09:00' },
            { artist: '', startsAt: '2026-11-19T16:00:00+09:00' },
          ],
        },
      },
    ]);
    const { items } = await service.list(undefined, '20', now);
    expect(items[0].artistNames).toEqual(['노이즈캔디', '삼보마스터']);
    expect(items[0].artists).toEqual([
      {
        name: '노이즈캔디',
        performances: [
          {
            startsAt: '2026-11-19T13:00:00+09:00',
            date: '2026-11-19',
            stageName: null,
          },
          {
            startsAt: '2026-11-19T15:00:00+09:00',
            date: '2026-11-19',
            stageName: null,
          },
        ],
      },
      {
        name: '삼보마스터',
        performances: [
          {
            startsAt: '2026-11-19T14:00:00+09:00',
            date: '2026-11-19',
            stageName: null,
          },
        ],
      },
    ]);
    expect(JSON.stringify(items[0].artists)).not.toContain('imageUrl');
  });

  it('uses discovered lineup names, merges alias spellings and caps at 50', async () => {
    const service = setup(
      [],
      [
        {
          id: 'fst_found',
          name: '발견 축제',
          venue: null,
          firstDate: '2026-11-20',
          lastDate: '2026-11-20',
          sortAt: '2026-11-20T00:00:00+09:00',
          packVersion: 0,
          flagsEnabled: false,
          thumbUrl: null,
          ticketLinks: [],
          status: 'discovered',
          sourceUrl: 'https://tickets.example.com/1',
          sourceUrls: ['https://tickets.example.com/1'],
          artists: [
            { name: '실리카겔 (Silica Gel)' },
            { name: 'Silica Gel' },
            ...Array.from({ length: 60 }, (_, i) => ({ name: `가수 ${i}` })),
          ],
        },
      ],
    );
    const { items } = await service.list(undefined, '20', now);
    expect(items[0].artistNames).toHaveLength(50);
    expect(items[0].artistNames.slice(0, 2)).toEqual([
      '실리카겔 (Silica Gel)',
      '가수 0',
    ]);
  });

  it('returns an empty list when no lineup is known', async () => {
    const service = setup([
      {
        id: 'fst_empty',
        publishedVersion: 1,
        published: {
          id: 'fst_empty',
          name: '빈 축제',
          venue: '공연장',
          days: [{ date: '2026-11-19', startsAt: '2026-11-19T13:00:00+09:00' }],
        },
      },
    ]);
    const { items } = await service.list(undefined, '20', now);
    expect(items[0].artistNames).toEqual([]);
  });
});
