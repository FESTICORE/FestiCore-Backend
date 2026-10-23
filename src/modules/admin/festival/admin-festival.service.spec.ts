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
    );

    await expect(service.list()).resolves.toEqual({
      items: [
        {
          id: 'fst_12345678',
          name: 'Festival',
          venue: 'Seoul',
          days: [],
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
    );

    await expect(
      service.publish(draft.id, '', undefined, null),
    ).rejects.toMatchObject({ status: 428 });
    await expect(
      service.publish(draft.id, '', '"d2"', null),
    ).rejects.toMatchObject({ status: 412 });
    expect(festivalRepo.save).not.toHaveBeenCalled();
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
