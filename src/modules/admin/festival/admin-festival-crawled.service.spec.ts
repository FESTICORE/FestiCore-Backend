import {
  AdminFestivalService,
  CrawledFestivalDetail,
} from './admin-festival.service';
import { AdminFestival, AdminFestivalVersion } from './festival.entity';

const detail: CrawledFestivalDetail = {
  id: 'fst_0123456789abcdef',
  name: 'Festival',
  venue: 'Seoul',
  firstDate: '2026-11-20',
  lastDate: '2026-11-20',
  sourceUrl: 'https://example.com/festival',
  ticketLinks: [],
  artists: ['Artist'],
};
const timetable = {
  days: [
    {
      date: '2026-11-20',
      startsAt: '2026-11-20T12:00:00+09:00',
      endsAt: '2026-11-20T22:00:00+09:00',
    },
  ],
  stages: [{ id: 'stg_main', name: 'Main', order: 1 }],
  sets: [
    {
      id: 'set_main',
      stageId: 'stg_main',
      artist: 'Artist',
      startsAt: '2026-11-20T13:00:00+09:00',
      endsAt: '2026-11-20T14:00:00+09:00',
    },
  ],
};
function fixture() {
  let stored: AdminFestival | null = null;
  let versions: unknown[] = [];
  const query = jest.fn((sql: string, parameters: string[]) => {
    const source = (stored?.published?.source ?? stored?.draft.source) as
      { url?: string } | undefined;
    return Promise.resolve(
      sql.includes('SELECT "id" FROM "admin_festivals"') &&
        source?.url === parameters[0]
        ? [{ id: stored!.id }]
        : [],
    );
  });
  const record = jest.fn().mockResolvedValue(undefined);
  const invalidatePack = jest.fn().mockResolvedValue(undefined);
  const enqueueFestival = jest.fn().mockResolvedValue(undefined);
  const findOne = jest.fn(() => Promise.resolve(structuredClone(stored)));
  const repo = {
    findOne,
    create: (row: AdminFestival) => row,
    save: jest.fn((row: AdminFestival) => {
      stored = structuredClone(row);
      return Promise.resolve(row);
    }),
  };
  const manager = {
    query,
    getRepository: (entity: unknown) =>
      entity === AdminFestival
        ? repo
        : {
            save: jest.fn((version: AdminFestivalVersion) => {
              versions.push(structuredClone(version));
              return Promise.resolve(version);
            }),
          },
  };
  const transaction = jest.fn(
    async (callback: (value: typeof manager) => Promise<unknown>) => {
      const before = structuredClone(stored);
      const beforeVersions = structuredClone(versions);
      try {
        return await callback(manager);
      } catch (error) {
        stored = before;
        versions = beforeVersions;
        throw error;
      }
    },
  );
  const service = new AdminFestivalService(
    {} as never,
    {} as never,
    { transaction } as never,
    { record } as never,
    { invalidatePack } as never,
    {} as never,
    { enqueueFestival } as never,
  );
  return {
    service,
    query,
    record,
    invalidatePack,
    enqueueFestival,
    manager,
    findOne,
    transaction,
    row: () => stored!,
    versions: () => versions,
  };
}

describe('atomic crawled publication', () => {
  it('creates a metadata pack and versions, audit, queue in one transaction then invalidates cache', async () => {
    const f = fixture();
    await expect(f.service.publishCrawled(detail, null)).resolves.toEqual({
      packVersion: 1,
      changed: true,
    });
    expect(f.row().published).toMatchObject({
      eventPeriod: { firstDate: detail.firstDate, lastDate: detail.lastDate },
      days: [],
      stages: [],
      sets: [],
      artists: ['Artist'],
      timetableStatus: 'unpublished',
    });
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.versions()).toHaveLength(1);
    expect(f.query.mock.calls[0]).toEqual([
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`crawl-source:${detail.sourceUrl}`],
    ]);
    expect(f.findOne).toHaveBeenCalledWith({
      where: { id: detail.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(
      f.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO "notification_deliveries"'),
      ),
    ).toBe(true);
    expect(f.enqueueFestival).toHaveBeenCalledWith(detail.id, f.manager);
    expect(f.record).toHaveBeenCalledWith(
      f.manager,
      expect.objectContaining({ action: 'festival.published' }),
    );
    expect(f.invalidatePack).toHaveBeenCalledWith(detail.id);
  });

  it('does not create versions or notifications when content is unchanged, even after time advances', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-01T00:00:00Z'));
    try {
      const f = fixture();
      await f.service.publishCrawled(detail, null);
      jest.setSystemTime(new Date('2026-11-03T00:00:00Z'));
      await expect(
        f.service.publishCrawled({ ...detail }, null),
      ).resolves.toEqual({ packVersion: 1, changed: false });
      expect(f.versions()).toHaveLength(1);
      expect(f.record).toHaveBeenCalledTimes(1);
      expect(f.enqueueFestival).toHaveBeenCalledTimes(1);
      expect(f.invalidatePack).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('upgrades a metadata pack without publishing or overwriting a human draft, including a null actor', async () => {
    const f = fixture();
    await f.service.publishCrawled(detail, null);
    f.row().draft = {
      ...f.row().draft,
      name: 'Private edit',
      rules: ['Private rule'],
    };
    f.row().draftVersion = 7;
    f.row().draftUpdatedBy = null;
    const before = structuredClone(f.row().draft);
    await expect(f.service.publishCrawled(detail, timetable)).resolves.toEqual({
      packVersion: 2,
      changed: true,
    });
    expect(f.row().published).toMatchObject({
      name: detail.name,
      rules: [],
      ...timetable,
      timetableStatus: 'verified',
    });
    expect(f.row().draft).toEqual(before);
    expect(f.row().draftVersion).toBe(7);
    await expect(f.service.publishCrawled(detail, null)).resolves.toEqual({
      packVersion: 2,
      changed: false,
    });
    expect(f.row().published).toMatchObject(timetable);
  });

  it('rolls back the initial insert and version on publication failure so a retry succeeds', async () => {
    const f = fixture();
    f.record.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(f.service.publishCrawled(detail, null)).rejects.toThrow(
      'audit unavailable',
    );
    expect(f.row()).toBeNull();
    expect(f.versions()).toHaveLength(0);
    expect(f.invalidatePack).not.toHaveBeenCalled();
    await expect(f.service.publishCrawled(detail, null)).resolves.toEqual({
      packVersion: 1,
      changed: true,
    });
  });

  it('retains the original pack ID when dates change the discovery ID', async () => {
    const f = fixture();
    await f.service.publishCrawled(detail, null);
    const draft = structuredClone(f.row().draft);
    await expect(
      f.service.publishCrawled(
        { ...detail, id: 'fst_fedcba9876543210', lastDate: '2026-11-21' },
        null,
      ),
    ).resolves.toEqual({ packVersion: 2, changed: true });
    expect(f.row().id).toBe(detail.id);
    expect(f.row().published).toMatchObject({
      id: detail.id,
      eventPeriod: { firstDate: detail.firstDate, lastDate: '2026-11-21' },
    });
    expect(f.row().draft).toEqual(draft);
    expect(f.invalidatePack).toHaveBeenLastCalledWith(detail.id);
  });

  it('rejects ambiguous exact source matches before any publication writes', async () => {
    const f = fixture();
    f.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: detail.id },
        { id: 'fst_fedcba9876543210' },
      ]);
    await expect(f.service.publishCrawled(detail, null)).rejects.toMatchObject({
      status: 409,
    });
    expect(f.row()).toBeNull();
    expect(f.versions()).toHaveLength(0);
    expect(f.invalidatePack).not.toHaveBeenCalled();
  });

  it('lets an admin incrementally upgrade an automatic metadata draft and publish it', async () => {
    const f = fixture();
    await f.service.publishCrawled(detail, null);
    await f.service.patch(detail.id, { days: timetable.days }, '"d1"', 'admin');
    expect(f.row().draft.timetableStatus).toBeUndefined();
    await expect(
      f.service.publish(detail.id, '', '"d2"', 'admin'),
    ).rejects.toMatchObject({ status: 400 });
    await f.service.patch(
      detail.id,
      { stages: timetable.stages, sets: timetable.sets },
      '"d2"',
      'admin',
    );
    expect(f.row().draft.timetableStatus).toBe('verified');
    await expect(
      f.service.publish(detail.id, '', '"d3"', 'admin'),
    ).resolves.toMatchObject({ packVersion: 2 });
    expect(f.row().published).toMatchObject({
      ...timetable,
      timetableStatus: 'verified',
    });
  });

  it('does not republish unchanged venue evidence merely because a crawl timestamp advances', async () => {
    const f = fixture();
    const location = {
      latitude: 37.5,
      longitude: 127.1,
      label: detail.venue,
      source: {
        name: 'Official',
        url: detail.sourceUrl,
        verifiedAt: '2026-11-01T00:00:00Z',
      },
    };
    await f.service.publishCrawled({ ...detail, location }, null);
    await expect(
      f.service.publishCrawled(
        {
          ...detail,
          location: {
            ...location,
            source: { ...location.source, verifiedAt: '2026-11-02T00:00:00Z' },
          },
        },
        null,
      ),
    ).resolves.toEqual({ packVersion: 1, changed: false });
    await expect(
      f.service.publishCrawled(
        { ...detail, location: { ...location, latitude: 37.6 } },
        null,
      ),
    ).resolves.toEqual({ packVersion: 2, changed: true });
  });

  it.each([
    { firstDate: '2026-11-20', lastDate: '2026-11-21' },
    { firstDate: '2026-12-01', lastDate: '2026-12-02' },
  ])(
    'keeps verified period and schedule coherent until replacement arrives: %j',
    async (period) => {
      const f = fixture();
      await f.service.publishCrawled(detail, timetable);
      await expect(
        f.service.publishCrawled(
          {
            ...detail,
            ...period,
            id: 'fst_fedcba9876543210',
            name: 'Updated name',
          },
          null,
        ),
      ).resolves.toEqual({ packVersion: 2, changed: true });
      expect(f.row().published).toMatchObject({
        name: 'Updated name',
        ...timetable,
        eventPeriod: { firstDate: detail.firstDate, lastDate: detail.lastDate },
      });
      await expect(
        f.service.publishCrawled(
          {
            ...detail,
            ...period,
            id: 'fst_fedcba9876543210',
            name: 'Updated name',
          },
          null,
        ),
      ).resolves.toEqual({ packVersion: 2, changed: false });
    },
  );

  it('rejects incomplete timetable replacement without changing an existing pack', async () => {
    const f = fixture();
    await f.service.publishCrawled(detail, timetable);
    await expect(
      f.service.publishCrawled(detail, { ...timetable, sets: [] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.row().publishedVersion).toBe(1);
    expect(f.row().published).toMatchObject(timetable);
    expect(f.versions()).toHaveLength(1);
  });
});

describe('recrawled artist images', () => {
  const image = (n: number) =>
    `/api/v1/festivals/images/00000000-0000-4000-8000-00000000000${n}.webp`;
  const withImages = (sets: unknown[]) => ({ ...timetable, sets });

  it('moves retained sets and the admin draft to the newest crawled artist image', async () => {
    const f = fixture();
    await f.service.publishCrawled(
      {
        ...detail,
        artists: [{ name: 'Artist (아티스트)', imageUrl: image(1) }],
      },
      withImages([{ ...timetable.sets[0], imageUrl: image(1) }]),
    );
    f.row().draft = { ...f.row().draft, rules: ['Private rule'] };
    f.row().draftVersion = 4;

    await expect(
      f.service.publishCrawled(
        {
          ...detail,
          artists: [{ name: 'Artist (아티스트)', imageUrl: image(2) }],
        },
        null,
      ),
    ).resolves.toEqual({ packVersion: 2, changed: true });

    const published = f.row().published!;
    expect(published.sets).toEqual([
      { ...timetable.sets[0], imageUrl: image(2) },
    ]);
    expect(published.artists).toEqual([
      { name: 'Artist (아티스트)', imageUrl: image(2) },
    ]);
    expect(f.row().draft).toMatchObject({
      rules: ['Private rule'],
      sets: [{ artist: 'Artist', imageUrl: image(2) }],
      artists: [{ name: 'Artist (아티스트)', imageUrl: image(2) }],
    });
    expect(f.row().draftVersion).toBe(5);
    expect(f.record).toHaveBeenCalledWith(
      f.manager,
      expect.objectContaining({
        actor: null,
        action: 'festival.draft.updated',
        before: expect.objectContaining({ draftVersion: 4 }) as unknown,
      }),
    );

    // 같은 사진으로 다시 돌면 팩과 초안 모두 그대로다.
    await expect(
      f.service.publishCrawled(
        {
          ...detail,
          artists: [{ name: 'Artist (아티스트)', imageUrl: image(2) }],
        },
        null,
      ),
    ).resolves.toEqual({ packVersion: 2, changed: false });
    expect(f.row().draftVersion).toBe(5);
  });

  it('keeps the stored image when the name matches no photo or more than one', async () => {
    const f = fixture();
    await f.service.publishCrawled(
      detail,
      withImages([{ ...timetable.sets[0], imageUrl: image(1) }]),
    );
    const draftVersion = f.row().draftVersion;
    for (const artists of [
      [{ name: 'Artist' }],
      [{ name: 'Other', imageUrl: image(3) }],
      [
        { name: 'Artist', imageUrl: image(2) },
        { name: 'artist', imageUrl: image(3) },
      ],
      [{ name: 'Artist', imageUrl: 'https://cdnimg.melon.co.kr/a.jpg' }],
    ]) {
      await f.service.publishCrawled({ ...detail, artists }, null);
      expect(f.row().published!.sets).toEqual([
        { ...timetable.sets[0], imageUrl: image(1) },
      ]);
      expect((f.row().draft.sets as { imageUrl?: string }[])[0].imageUrl).toBe(
        image(1),
      );
    }
    expect(f.row().draftVersion).toBe(draftVersion);
  });

  it('fills an empty draft lineup and replaces a stale draft photo credit', async () => {
    const f = fixture();
    await f.service.publishCrawled({ ...detail, artists: [] }, null);
    const credited = {
      name: 'Artist',
      imageUrl: image(2),
      imageCredit: { author: 'A', license: 'CC BY 4.0' },
    };
    await f.service.publishCrawled({ ...detail, artists: [credited] }, null);
    expect(f.row().draft.artists).toEqual([credited]);
    await f.service.publishCrawled(
      { ...detail, artists: [{ name: 'Artist', imageUrl: image(3) }] },
      null,
    );
    expect(f.row().draft.artists).toEqual([
      { name: 'Artist', imageUrl: image(3) },
    ]);
  });
});
