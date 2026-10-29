import { HttpException } from '@nestjs/common';
import { AdminFestivalService } from './admin-festival.service';
import { AdminFestival } from './festival.entity';

describe('AdminFestivalService optimistic edits', () => {
  it('lists festivals before the crawler proposal table exists', async () => {
    const query = jest.fn().mockResolvedValue([{ present: null }]);
    const service = new AdminFestivalService(
      {
        find: jest.fn().mockResolvedValue([
          {
            id: 'fst_12345678',
            draft: {
              name: 'Festival',
              venue: 'Seoul',
              days: [],
              thumbUrl: 'https://example.com/poster.webp',
            },
            draftVersion: 1,
            publishedVersion: 0,
          },
          {
            id: 'fst_87654321',
            draft: { name: 'Second', venue: 'Busan', days: [], thumbUrl: null },
            draftVersion: 2,
            publishedVersion: 1,
          },
        ]),
      } as never,
      {} as never,
      { query } as never,
      {} as never,
      {} as never,
      {} as never,
      { enqueueFestival: jest.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(service.list()).resolves.toEqual({
      items: [
        {
          id: 'fst_12345678',
          name: 'Festival',
          venue: 'Seoul',
          days: [],
          eventPeriod: null,
          thumbUrl: 'https://example.com/poster.webp',
          draftVersion: 1,
          publishedVersion: 0,
          openProposals: 0,
        },
        {
          id: 'fst_87654321',
          name: 'Second',
          venue: 'Busan',
          days: [],
          eventPeriod: null,
          thumbUrl: null,
          draftVersion: 2,
          publishedVersion: 1,
          openProposals: 0,
        },
      ],
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  const row = {
    id: 'fst_12345678',
    draft: { name: 'Current' },
    draftVersion: 2,
  };
  const save = jest.fn();
  const service = new AdminFestivalService(
    {} as never,
    {} as never,
    {
      transaction: async (callback: (manager: unknown) => Promise<unknown>) =>
        callback({
          getRepository: () => ({ findOne: () => Promise.resolve(row), save }),
        }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    { enqueueFestival: jest.fn().mockResolvedValue(undefined) } as never,
  );

  beforeEach(() => save.mockClear());

  it('rejects stale If-Match with 412 and leaves the draft untouched', async () => {
    try {
      await service.patch(
        'fst_12345678',
        { name: 'Stale' },
        '"d1"',
        'adm_12345678',
      );
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(412);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'DRAFT_CONFLICT',
        draftVersion: 2,
      });
      expect(save).not.toHaveBeenCalled();
    }
  });

  it('requires the quoted draft ETag', async () => {
    await expect(
      service.patch('fst_12345678', { name: 'New' }, 'd2', null),
    ).rejects.toMatchObject({ status: 428 });
  });
});

describe('discovered festival import', () => {
  const id = 'fst_0123456789abcdef';
  const days = [
    {
      date: '2026-11-20',
      startsAt: '2026-11-20T12:00:00+09:00',
      endsAt: '2026-11-20T22:00:00+09:00',
    },
    {
      date: '2026-11-21',
      startsAt: '2026-11-21T12:00:00+09:00',
      endsAt: '2026-11-21T22:00:00+09:00',
    },
  ];
  const discovered = {
    id,
    name: '발견된 축제',
    venue: '올림픽공원',
    firstDate: '2026-11-20',
    lastDate: '2026-11-21',
    thumbUrl:
      '/api/v1/festivals/images/3fa85f64-5717-4562-b3fc-2c963f66afa6.webp',
    ticketLinks: [
      {
        label: '멜론티켓',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=1',
      },
    ],
    sourceUrl: 'https://ticket.melon.com/performance/index.htm?prodId=1',
  };

  function fixture(
    options: {
      existing?: boolean;
      insertError?: Error;
      auditError?: Error;
    } = {},
  ) {
    const query = options.insertError
      ? jest.fn().mockRejectedValue(options.insertError)
      : jest
          .fn()
          .mockResolvedValue([
            { draftUpdatedAt: new Date('2026-11-19T00:00:00Z') },
          ]);
    const record = options.auditError
      ? jest.fn().mockRejectedValue(options.auditError)
      : jest.fn().mockResolvedValue(undefined);
    const discoveredLookup = jest.fn().mockResolvedValue(discovered);
    const manager = { query };
    const service = new AdminFestivalService(
      {
        exist: jest.fn().mockResolvedValue(options.existing ?? false),
        create: jest.fn((row: unknown) => row),
      } as never,
      {} as never,
      {
        transaction: (callback: (manager: unknown) => Promise<unknown>) =>
          callback(manager),
      } as never,
      { record } as never,
      {} as never,
      { discovered: discoveredLookup } as never,
      { enqueueFestival: jest.fn().mockResolvedValue(undefined) } as never,
    );
    return { service, query, record, discoveredLookup, manager };
  }

  it('preserves the public ID and source in an unpublished audited draft', async () => {
    const { service, query, record, manager } = fixture();
    await expect(
      service.importDiscovered(id, { days }, 'adm_1'),
    ).resolves.toMatchObject({
      id,
      draftVersion: 1,
      name: discovered.name,
      venue: discovered.venue,
      days,
      thumbUrl: discovered.thumbUrl,
      ticketLinks: discovered.ticketLinks,
      source: { url: discovered.sourceUrl },
    });
    const [sql, values] = query.mock.calls[0] as unknown as [string, string[]];
    expect(sql).toContain('INSERT INTO admin_festivals');
    expect(values[0]).toBe(id);
    expect(values[2]).toBe('adm_1');
    const draft = JSON.parse(values[1]) as unknown;
    expect(draft).toMatchObject({ id, name: discovered.name, days });
    expect(record).toHaveBeenCalledWith(manager, {
      actor: 'adm_1',
      action: 'festival.discovered.imported',
      target: `festival:${id}`,
      before: null,
      after: { draftVersion: 1, draft },
    });
  });

  it('keeps verified venue coordinates when importing a discovered festival', async () => {
    const { service, query, discoveredLookup } = fixture();
    const location = {
      latitude: 37.5,
      longitude: 127.1,
      label: discovered.venue,
      source: {
        name: '멜론티켓',
        url: discovered.sourceUrl,
        verifiedAt: '2026-10-28T11:00:00Z',
      },
    };
    discoveredLookup.mockResolvedValue({ ...discovered, location });
    await service.importDiscovered(id, { days }, 'adm_1');
    const calls = query.mock.calls as unknown as [string, string[]][];
    const values = calls[0][1];
    const draft = JSON.parse(values[1]) as {
      directions: { location: unknown };
    };
    expect(draft.directions.location).toEqual(location);
  });

  it('imports a discovered date range without inventing daily operating hours', async () => {
    const { service, query, record } = fixture();
    const response = await service.importDiscovered(id, {}, 'adm_1');
    expect(response).toMatchObject({
      id,
      days: [],
      eventPeriod: {
        firstDate: discovered.firstDate,
        lastDate: discovered.lastDate,
      },
      source: { url: discovered.sourceUrl },
      draftVersion: 1,
    });
    const calls = query.mock.calls as unknown[][];
    const values = calls[0][1] as [string, string, string];
    expect(JSON.parse(values[1])).toMatchObject({
      days: [],
      eventPeriod: {
        firstDate: discovered.firstDate,
        lastDate: discovered.lastDate,
      },
    });
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate before fetching the discovery catalog', async () => {
    const { service, discoveredLookup, query } = fixture({ existing: true });
    await expect(
      service.importDiscovered(id, { days }, null),
    ).rejects.toMatchObject({ status: 409 });
    expect(discoveredLookup).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects dates that do not match the discovered range', async () => {
    const { service, query } = fixture();
    await expect(
      service.importDiscovered(id, { days: days.slice(0, 1) }, null),
    ).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an explicitly null day list', async () => {
    const { service, query } = fixture();
    await expect(
      service.importDiscovered(
        id,
        { days: null as unknown as unknown[] },
        null,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('maps a concurrent insert collision to 409', async () => {
    const error = Object.assign(new Error('duplicate key'), {
      driverError: { code: '23505' },
    });
    const { service } = fixture({ insertError: error });
    await expect(
      service.importDiscovered(id, { days }, null),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('does not report success when the audit write fails', async () => {
    const { service } = fixture({ auditError: new Error('audit unavailable') });
    await expect(service.importDiscovered(id, { days }, null)).rejects.toThrow(
      'audit unavailable',
    );
  });
});

describe('date-only draft publication', () => {
  it('rejects publication before a verified timetable and leaves the pack untouched', async () => {
    const row = {
      id: 'fst_0123456789abcdef',
      draft: {
        id: 'fst_0123456789abcdef',
        name: '함평 겨울 행사',
        venue: '함평',
        timezone: 'Asia/Seoul',
        eventPeriod: { firstDate: '2026-10-23', lastDate: '2026-11-08' },
        days: [],
        flagsEnabled: false,
        stages: [],
        sets: [],
        zones: [],
        flags: [],
        checklist: [],
        rules: [],
        mapImageUrl: null,
        mapAspect: null,
        source: { name: 'NOL World', verifiedAt: '2026-10-23T12:00:00Z' },
      },
      draftVersion: 1,
      published: null,
      publishedVersion: 0,
    };
    const save = jest.fn();
    const enqueueFestival = jest.fn();
    const audit = jest.fn();
    const service = new AdminFestivalService(
      {} as never,
      {} as never,
      {
        transaction: (callback: (manager: unknown) => Promise<unknown>) =>
          callback({
            getRepository: () => ({
              findOne: () => Promise.resolve(row),
              save,
            }),
          }),
      } as never,
      { record: audit } as never,
      {} as never,
      {} as never,
      { enqueueFestival } as never,
    );
    await expect(
      service.publish(row.id, '', '"d1"', 'adm_1'),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(save).not.toHaveBeenCalled();
    expect(enqueueFestival).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(row.published).toBeNull();
  });
});

describe('festival edit audit', () => {
  const days = [
    {
      date: '2026-11-20',
      startsAt: '2026-11-20T12:00:00+09:00',
      endsAt: '2026-11-20T22:00:00+09:00',
    },
  ];

  it('saves a new festival and its audit record in one transaction', async () => {
    let savedDraft: unknown;
    const save = jest.fn((row: AdminFestival): Promise<AdminFestival> => {
      savedDraft = row.draft;
      return Promise.resolve(row);
    });
    const manager = { getRepository: () => ({ save }) };
    const record = jest.fn().mockResolvedValue(undefined);
    const service = new AdminFestivalService(
      { create: jest.fn((row: unknown): unknown => row) } as never,
      {} as never,
      {
        transaction: (callback: (manager: unknown) => Promise<unknown>) =>
          callback(manager),
      } as never,
      { record } as never,
      {} as never,
      {} as never,
      { enqueueFestival: jest.fn().mockResolvedValue(undefined) } as never,
    );

    const result = (await service.create(
      { name: 'Festival', venue: 'Venue', days },
      'adm_12345678',
    )) as unknown as { id: string };

    expect(result.id).toMatch(/^fst_/);
    expect(save).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(manager, {
      actor: 'adm_12345678',
      action: 'festival.created',
      target: `festival:${result.id}`,
      before: null,
      after: {
        draftVersion: 1,
        draft: savedDraft,
      },
    });
  });

  it('rejects an edit when its audit record cannot be written', async () => {
    const row = {
      id: 'fst_12345678',
      draftVersion: 1,
      draftUpdatedBy: null,
      draft: {
        id: 'fst_12345678',
        name: 'Festival',
        venue: 'Venue',
        timezone: 'Asia/Seoul',
        days,
        flagsEnabled: false,
        stages: [],
        sets: [],
        zones: [],
        flags: [],
        checklist: [],
        rules: [],
        mapImageUrl: null,
        mapAspect: null,
        source: { name: 'Official', verifiedAt: '2026-11-18T12:00:00+09:00' },
      },
    };
    const initialDraft = row.draft;
    const save = jest.fn().mockResolvedValue(row);
    const manager = {
      getRepository: () => ({
        findOne: jest.fn().mockResolvedValue(row),
        save,
      }),
    };
    const record = jest.fn().mockRejectedValue(new Error('audit unavailable'));
    const service = new AdminFestivalService(
      {} as never,
      {} as never,
      {
        transaction: (callback: (manager: unknown) => Promise<unknown>) =>
          callback(manager),
      } as never,
      { record } as never,
      {} as never,
      {} as never,
      { enqueueFestival: jest.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      service.patch(row.id, { name: 'Updated' }, '"d1"', 'adm_12345678'),
    ).rejects.toThrow('audit unavailable');
    expect(save).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(manager, {
      actor: 'adm_12345678',
      action: 'festival.draft.updated',
      target: `festival:${row.id}`,
      before: {
        draftVersion: 1,
        draft: initialDraft,
      },
      after: {
        draftVersion: 2,
        draft: row.draft,
      },
    });
  });
});

describe('festival source freshness warnings', () => {
  it('warns only after seven days while allowing draft reads', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-25T12:00:00+09:00'));
    try {
      const row = {
        id: 'fst_12345678',
        draft: {
          source: { name: 'Official', verifiedAt: '2026-11-18T12:00:00+09:00' },
        },
        draftVersion: 1,
      };
      const service = new AdminFestivalService(
        { findOneBy: jest.fn().mockResolvedValue(row) } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { enqueueFestival: jest.fn().mockResolvedValue(undefined) } as never,
      );

      await expect(service.getDraft(row.id)).resolves.toMatchObject({
        warnings: [],
      });
      jest.setSystemTime(new Date('2026-11-25T12:00:00.001+09:00'));
      await expect(service.getDraft(row.id)).resolves.toMatchObject({
        warnings: [expect.stringContaining('7일')],
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('pack update delivery queue', () => {
  it('queues subscribers and audits publish and rollback in the same transaction', async () => {
    const draft = {
      id: 'fst_12345678',
      name: 'Festival',
      venue: 'Venue',
      timezone: 'Asia/Seoul',
      days: [
        {
          date: '2026-11-20',
          startsAt: '2026-11-20T12:00:00+09:00',
          endsAt: '2026-11-20T22:00:00+09:00',
        },
      ],
      flagsEnabled: false,
      stages: [{ id: 'stg_main', name: 'Main', order: 1 }],
      sets: [],
      zones: [],
      flags: [],
      checklist: [],
      rules: [],
      mapImageUrl: null,
      mapAspect: null,
      source: {
        name: 'Official',
        verifiedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
          .toISOString()
          .replace(/\.\d{3}Z$/, 'Z'),
      },
    };
    const row = {
      id: draft.id,
      draft,
      draftVersion: 1,
      publishedVersion: 0,
      published: null as typeof draft | null,
    };
    const festivalRepo = {
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn().mockResolvedValue(row),
    };
    const versionRepo = {
      save: jest.fn(),
      findOneBy: jest.fn().mockResolvedValue({ pack: draft }),
    };
    const query = jest.fn().mockResolvedValue([{ id: 'one' }, { id: 'two' }]);
    const record = jest.fn().mockResolvedValue(undefined);
    const invalidatePack = jest.fn().mockResolvedValue(undefined);
    const enqueueFestival = jest.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: (entity: unknown) =>
        entity === AdminFestival ? festivalRepo : versionRepo,
      query,
    };
    const service = new AdminFestivalService(
      {} as never,
      {} as never,
      {
        transaction: (callback: (manager: unknown) => Promise<unknown>) =>
          callback(manager),
      } as never,
      { record } as never,
      { invalidatePack } as never,
      {} as never,
      { enqueueFestival } as never,
    );

    await expect(
      service.publish(draft.id, '', undefined, null),
    ).rejects.toMatchObject({ status: 428 });
    await expect(
      service.publish(draft.id, '', '"d2"', null),
    ).rejects.toMatchObject({ status: 412 });
    expect(festivalRepo.save).not.toHaveBeenCalled();
    expect(enqueueFestival).not.toHaveBeenCalled();
    await expect(
      service.publish(draft.id, '', '"d1"', null),
    ).resolves.toMatchObject({
      packVersion: 1,
      pushedDevices: 2,
      warnings: [expect.stringContaining('7일')],
    });
    const calls = query.mock.calls as unknown[][];
    expect(calls[0][0]).toContain('s."packUpdates" = true');
    expect(calls[0][1]).toEqual([draft.id, `pack-updated:${draft.id}:1`]);
    expect(enqueueFestival).toHaveBeenCalledWith(draft.id, manager);
    expect(record).toHaveBeenCalledWith(manager, {
      actor: null,
      action: 'festival.published',
      target: `festival:${draft.id}`,
      before: { packVersion: 0 },
      after: { packVersion: 1, note: '' },
    });
    await expect(service.rollback(draft.id, 1, null)).resolves.toMatchObject({
      packVersion: 2,
      pushedDevices: 2,
    });
    expect(enqueueFestival).toHaveBeenCalledTimes(2);
    expect(invalidatePack).toHaveBeenCalledTimes(2);
    expect(invalidatePack).toHaveBeenCalledWith(draft.id);
    record.mockRejectedValueOnce(new Error('transaction failed'));
    await expect(service.publish(draft.id, '', '"d1"', null)).rejects.toThrow(
      'transaction failed',
    );
    expect(invalidatePack).toHaveBeenCalledTimes(2);
    expect(calls[1][1]).toEqual([draft.id, `pack-updated:${draft.id}:2`]);
    expect(record).toHaveBeenCalledWith(manager, {
      actor: null,
      action: 'festival.rolled_back',
      target: `festival:${draft.id}`,
      before: { packVersion: 1 },
      after: { packVersion: 2, toVersion: 1 },
    });
  });
});
