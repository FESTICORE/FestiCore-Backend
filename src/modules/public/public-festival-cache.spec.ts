import { NotFoundException } from '@nestjs/common';
import { PublicFestivalService } from './public-festival.service';

describe('PublicFestivalService published cache', () => {
  const id = 'fst_12345678';
  const oldPack = { id, name: 'Old', packVersion: 1 };
  const newPack = { id, name: 'New', packVersion: 2 };

  function setup() {
    const values = new Map<string, object>();
    let generation = 0;
    const findOne = jest.fn().mockResolvedValue({
      published: oldPack,
      publishedVersion: 1,
    });
    const cache = {
      packGeneration: jest.fn(() => Promise.resolve(generation)),
      getPack: jest.fn((_id: string, gen: number) =>
        Promise.resolve(values.get(`${_id}:g${gen}`) ?? null),
      ),
      setPack: jest.fn((_id: string, gen: number, document: object) => {
        values.set(`${_id}:g${gen}`, document);
        return Promise.resolve();
      }),
      invalidatePack: jest.fn(() => {
        generation += 1;
        return Promise.resolve();
      }),
    };
    const visibleRows: {
      id: string;
      seed: string | null;
      artistName: string | null;
      reviewFestivalId: string | null;
      festivalSourceUrl: string | null;
      author: string | null;
      license: string | null;
      licenseUrl: string | null;
      sourceUrl: string | null;
      rightsRunId: string | null;
    }[] = [];
    const dataSource = {
      query: jest.fn().mockImplementation(() => Promise.resolve(visibleRows)),
    };
    const service = new PublicFestivalService(
      { findOne } as never,
      {} as never,
      dataSource as never,
      cache as never,
    );
    return { service, cache, findOne, visibleRows, dataSource };
  }

  it('serves a hit without querying the database', async () => {
    const { service, cache, findOne } = setup();
    await service.published(id);
    findOne.mockClear();
    await expect(service.published(id)).resolves.toMatchObject(oldPack);
    expect(findOne).not.toHaveBeenCalled();
    expect(cache.setPack).toHaveBeenCalledTimes(1);
  });

  it('does not cache unpublished festivals', async () => {
    const { service, cache, findOne } = setup();
    findOne.mockResolvedValue(null);
    await expect(service.published(id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(cache.setPack).not.toHaveBeenCalled();
  });

  it('includes each published set artist with a stored image in detail and pack', async () => {
    const { service, findOne, visibleRows } = setup();
    const imageUrl =
      '/api/v1/festivals/images/00000000-0000-4000-8000-000000000001.webp';
    findOne.mockResolvedValue({
      publishedVersion: 1,
      published: {
        id,
        packVersion: 1,
        stages: [{ id: 'stg_main', name: '메인 무대', order: 1 }],
        sets: [
          {
            stageId: 'stg_main',
            artist: '밴드',
            startsAt: '2026-11-19T13:00:00+09:00',
            endsAt: '2026-11-19T14:00:00+09:00',
          },
          {
            stageId: 'stg_main',
            artist: '  밴드  ',
            startsAt: '2026-11-20T13:00:00+09:00',
            endsAt: '2026-11-20T14:00:00+09:00',
            imageUrl,
          },
          {
            stageId: 'stg_main',
            artist: '솔로',
            startsAt: '2026-11-20T15:00:00+09:00',
            endsAt: '2026-11-20T16:00:00+09:00',
            imageUrl: 'https://external.example/artist.jpg',
          },
        ],
      },
    });
    visibleRows.push({
      id: imageUrl.match(/[0-9a-f-]{36}/)![0],
      seed: null,
      artistName: null,
      reviewFestivalId: null,
      festivalSourceUrl: null,
      author: null,
      license: null,
      licenseUrl: null,
      sourceUrl: null,
      rightsRunId: null,
    });
    await expect(service.detail(id)).resolves.toMatchObject({
      artists: [
        { name: '밴드', imageUrl },
        { name: '솔로', imageUrl: null },
      ],
      timetable: [
        { artist: '밴드', imageUrl: null },
        {
          artist: '  밴드  ',
          stageName: '메인 무대',
          date: '2026-11-20',
          imageUrl,
        },
        { artist: '솔로', imageUrl: null },
      ],
    });
    await expect(service.published(id)).resolves.toMatchObject({
      artists: [
        { name: '밴드', imageUrl },
        { name: '솔로', imageUrl: null },
      ],
    });
    const version = await service.version(id);
    const packed = await service.publishedPack(id);
    expect(version.etag).toBe(packed.etag);
    expect(version.etag).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it('an older reader cannot revive a pack after invalidation', async () => {
    const { service, cache, findOne } = setup();
    let finishRead!: (value: object) => void;
    findOne.mockImplementationOnce(
      () => new Promise((resolve) => (finishRead = resolve)),
    );
    const oldRead = service.published(id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await cache.invalidatePack();
    finishRead({ published: oldPack, publishedVersion: 1 });
    await oldRead;
    findOne.mockResolvedValue({ published: newPack, publishedVersion: 2 });
    await expect(service.published(id)).resolves.toMatchObject(newPack);
    expect(cache.getPack).toHaveBeenLastCalledWith(id, 1);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('requires one exact current artist at the approved festival source', async () => {
    const { service, findOne } = setup();
    findOne.mockResolvedValue({
      publishedVersion: 1,
      published: {
        id,
        packVersion: 1,
        source: {
          url: 'https://ticket.melon.com/performance/index.htm?prodId=213769',
        },
        sets: [{ artist: '가수 A', startsAt: '2026-11-19T13:00:00+09:00' }],
      },
    });
    const source =
      'https://ticket.melon.com/performance/index.htm?prodId=213769';
    await expect(service.hasCurrentArtist(id, source, '가수 A')).resolves.toBe(
      true,
    );
    await expect(service.hasCurrentArtist(id, source, '가수 B')).resolves.toBe(
      false,
    );
    await expect(
      service.hasCurrentArtist(id, 'https://example.org/other', '가수 A'),
    ).resolves.toBe(false);
  });

  it('hides a cached Commons portrait when the current published roster removes its artist', async () => {
    const { service, findOne, visibleRows } = setup();
    const source =
      'https://ticket.melon.com/performance/index.htm?prodId=213769';
    const imageId = '00000000-0000-4000-8000-000000000003';
    const published = (artist: string) => ({
      id,
      packVersion: 1,
      source: { url: source },
      sets: [{ artist, startsAt: '2026-11-19T13:00:00+09:00' }],
    });
    findOne.mockResolvedValue({
      publishedVersion: 1,
      published: published('가수 A'),
    });
    visibleRows.push({
      id: imageId,
      seed: 'commons-approved-profile',
      artistName: '가수 A',
      reviewFestivalId: id,
      festivalSourceUrl: source,
      author: '사진가',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Artist_A.jpg',
      rightsRunId: 'latest-success',
    });
    const before = await service.publishedPack(id);
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(before.document.artists).toEqual([
      expect.objectContaining({
        imageUrl: `/api/v1/festivals/images/${imageId}.webp`,
      }),
    ]);

    findOne.mockResolvedValue({
      publishedVersion: 1,
      published: published('가수 B'),
    });
    const after = await service.publishedPack(id);
    expect(after.document.artists).toEqual([
      expect.objectContaining({ imageUrl: null }),
    ]);
    expect(after.etag).not.toBe(before.etag);
  });

  it('hides a published list thumbnail approved for a different festival ID', async () => {
    const source =
      'https://ticket.melon.com/performance/index.htm?prodId=213769';
    const imageId = '00000000-0000-4000-8000-000000000004';
    const pack = {
      id,
      name: '새 공연',
      venue: '공연장',
      source: { url: source },
      thumbUrl: `/api/v1/festivals/images/${imageId}.webp`,
      days: [
        {
          date: '2026-11-19',
          startsAt: '2026-11-19T13:00:00+09:00',
        },
      ],
      sets: [{ artist: '가수 A', startsAt: '2026-11-19T13:00:00+09:00' }],
    };
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest
        .fn()
        .mockResolvedValue([{ id, publishedVersion: 1, published: pack }]),
    };
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT image.id, source.'))
        return Promise.resolve([
          {
            id: imageId,
            seed: 'commons-approved-profile',
            reviewFestivalId: 'fst_previous',
            festivalSourceUrl: source,
            artistName: '가수 A',
          },
        ]);
      return Promise.resolve([]);
    });
    const service = new PublicFestivalService(
      { createQueryBuilder: () => builder } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    const result = await service.list(
      undefined,
      '20',
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(result.items[0]).toMatchObject({ id, thumbUrl: null });
  });

  it('does not expose malformed internal thumbnails in the list or query them as UUIDs', async () => {
    const published = (festivalId: string, thumbUrl: string) => ({
      id: festivalId,
      name: '새 공연',
      venue: '공연장',
      thumbUrl,
      days: [{ date: '2026-11-19', startsAt: '2026-11-19T13:00:00+09:00' }],
    });
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id,
          publishedVersion: 1,
          published: published(
            id,
            `/api/v1/festivals/images/${'-'.repeat(36)}.webp`,
          ),
        },
        {
          id: 'fst_external',
          publishedVersion: 1,
          published: published(
            'fst_external',
            'https://festival.example.com/poster.webp',
          ),
        },
      ]),
    };
    const query = jest.fn().mockResolvedValue([]);
    const service = new PublicFestivalService(
      { createQueryBuilder: () => builder } as never,
      {} as never,
      { query } as never,
      {} as never,
    );

    const result = await service.list(
      undefined,
      '20',
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, thumbUrl: null }),
        expect.objectContaining({
          id: 'fst_external',
          thumbUrl: 'https://festival.example.com/poster.webp',
        }),
      ]),
    );
    expect(
      (query.mock.calls as [string][]).filter(([sql]) =>
        sql.includes('SELECT image.id, source.'),
      ),
    ).toHaveLength(0);
  });
});
