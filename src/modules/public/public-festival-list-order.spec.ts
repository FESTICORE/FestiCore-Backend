import { publicFestivalTestDataSource } from '../../../test/public-festival-test-data-source';
import { PublicFestivalService } from './public-festival.service';

describe('PublicFestivalService list order', () => {
  const today = new Date('2026-10-22T00:00:00Z');

  function published(id: string, firstDate: string, lastDate: string) {
    return {
      id,
      publishedVersion: 1,
      published: {
        id,
        name: id,
        venue: '공연장',
        eventPeriod: { firstDate, lastDate },
        days: [],
        sets: [],
        stages: [],
        artists: [],
      },
    };
  }

  function discovered(id: string, firstDate: string, lastDate: string) {
    return {
      id,
      name: id,
      venue: '공연장',
      firstDate,
      lastDate,
      sortAt: `${firstDate}T00:00:00+09:00`,
      packVersion: 0,
      flagsEnabled: false,
      thumbUrl: null,
      ticketLinks: [],
      status: 'discovered',
      sourceUrl: `https://example.com/${id}`,
      sourceUrls: [`https://example.com/${id}`],
    };
  }

  it('keeps live and future entries ahead of ended entries across page boundaries', async () => {
    const live = published('fst_live', '2026-10-20', '2026-10-23');
    const future = published('fst_future', '2026-11-01', '2026-11-02');
    const ended = published('fst_ended', '2026-10-01', '2026-10-15');
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest
        .fn()
        .mockResolvedValueOnce([live, future])
        .mockResolvedValueOnce([future, ended])
        .mockResolvedValueOnce([ended])
        .mockResolvedValueOnce([ended])
        .mockResolvedValueOnce([]),
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
    jest
      .spyOn(internals, 'discoveryCatalog')
      .mockResolvedValue([
        discovered('fst_foundfuture', '2026-11-03', '2026-11-03'),
        discovered('fst_foundended', '2026-10-02', '2026-10-10'),
      ]);
    jest.spyOn(internals, 'attachStoredImages').mockResolvedValue(new Map());

    const ids: string[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
      const page = await service.list(cursor, '1', today);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      if (pageNumber < 4) expect(cursor).toContain('~v2~2026-10-22~');
      else expect(cursor).toBeUndefined();
    }
    expect(ids).toEqual([
      'fst_live',
      'fst_future',
      'fst_foundfuture',
      'fst_ended',
      'fst_foundended',
    ]);
    expect(builder.orderBy).toHaveBeenCalledWith(
      expect.stringContaining('THEN 0 WHEN'),
      'ASC',
    );
    expect(builder.addOrderBy).toHaveBeenCalledWith(
      expect.stringContaining('ELSE NULL END'),
      'DESC',
    );
    expect(builder.addOrderBy).toHaveBeenCalledWith('festival.id', 'ASC');
    expect(builder.take).toHaveBeenCalledWith(2);
  });

  it('pins the sorting day in the cursor when the next request crosses midnight', async () => {
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest
        .fn()
        .mockResolvedValueOnce([
          published('fst_live', '2026-10-20', '2026-10-22'),
          published('fst_future', '2026-11-01', '2026-11-02'),
        ])
        .mockResolvedValueOnce([
          published('fst_future', '2026-11-01', '2026-11-02'),
        ]),
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
    jest.spyOn(internals, 'discoveryCatalog').mockResolvedValue([]);
    jest.spyOn(internals, 'attachStoredImages').mockResolvedValue(new Map());

    const first = await service.list(undefined, '1', today);
    expect(first.nextCursor).toContain('~v2~2026-10-22~0~');
    const second = await service.list(
      first.nextCursor!,
      '1',
      new Date('2026-10-23T00:00:00Z'),
    );
    expect(second.items.map((item) => item.id)).toEqual(['fst_future']);
    expect(builder.orderBy).toHaveBeenLastCalledWith(
      expect.stringContaining("'2026-10-22'"),
      'ASC',
    );
  });

  it('restarts a valid legacy cursor at its original floor and continues with v2', async () => {
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest
        .fn()
        .mockResolvedValueOnce([
          published('fst_live', '2026-10-20', '2026-10-23'),
          published('fst_future', '2026-11-01', '2026-11-02'),
        ])
        .mockResolvedValueOnce([
          published('fst_future', '2026-11-01', '2026-11-02'),
        ]),
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
    jest.spyOn(internals, 'discoveryCatalog').mockResolvedValue([]);
    jest.spyOn(internals, 'attachStoredImages').mockResolvedValue(new Map());

    const first = await service.list(
      '2026-10-01~2026-10-20T12:00:00+09:00~fst_older',
      '1',
      today,
    );
    expect(first.items.map((item) => item.id)).toEqual(['fst_live']);
    expect(first.nextCursor).toBe(
      '2026-10-01~v2~2026-10-22~0~2026-10-20~fst_live',
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('>= :floor'),
      { floor: '2026-10-01' },
    );
    expect(builder.andWhere.mock.calls).toHaveLength(2);

    const second = await service.list(first.nextCursor!, '1', today);
    expect(second.items.map((item) => item.id)).toEqual(['fst_future']);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects malformed legacy cursors', async () => {
    const service = new PublicFestivalService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.list('2026-10-01~invalid~fst_a', '1', today),
    ).rejects.toThrow('지원하지 않는 after 커서');
    await expect(
      service.list('2026-10-01~2026-10-20T12:00:00+99:00~fst_a', '1', today),
    ).rejects.toThrow('지원하지 않는 after 커서');
  });
});
