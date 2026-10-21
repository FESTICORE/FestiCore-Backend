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
            draft: { name: 'Festival', venue: 'Seoul', days: [] },
            draftVersion: 1,
            publishedVersion: 0,
          },
        ]),
      } as never,
      {} as never,
      { query } as never,
    );

    await expect(service.list()).resolves.toMatchObject({
      items: [{ id: 'fst_12345678', openProposals: 0 }],
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

describe('pack update delivery queue', () => {
  it('queues subscribers in the same transaction for publish and rollback', async () => {
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
      source: { name: 'Official', verifiedAt: '2026-11-18T12:00:00+09:00' },
    };
    const row = {
      id: draft.id,
      draft,
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
    );

    await expect(service.publish(draft.id, '', null)).resolves.toMatchObject({
      packVersion: 1,
      pushedDevices: 2,
    });
    const calls = query.mock.calls as unknown[][];
    expect(calls[0][0]).toContain('s."packUpdates" = true');
    expect(calls[0][1]).toEqual([draft.id, `pack-updated:${draft.id}:1`]);
    await expect(service.rollback(draft.id, 1, null)).resolves.toMatchObject({
      packVersion: 2,
      pushedDevices: 2,
    });
    expect(calls[1][1]).toEqual([draft.id, `pack-updated:${draft.id}:2`]);
  });
});
