import { DataSource, EntityManager } from 'typeorm';
import {
  AdminFestival,
  AdminFestivalVersion,
} from '../admin/festival/festival.entity';
import { Flag } from './flag.entity';
import { FlagPackSyncService } from './flag-pack-sync.service';

describe('FlagPackSyncService', () => {
  it('updates the offline pack version when a public flag changes or is hidden', async () => {
    const base = {
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
      flagsEnabled: true,
      stages: [{ id: 'stg_12345678', name: 'Main', order: 1 }],
      sets: [],
      zones: [],
      flags: [],
      checklist: [],
      rules: [],
      mapImageUrl: null,
      mapAspect: null,
      source: { name: 'Official', verifiedAt: '2026-11-18T12:00:00+09:00' },
    };
    const festival = {
      id: base.id,
      draft: { ...base },
      draftVersion: 1,
      published: { ...base, packVersion: 1 },
      publishedVersion: 1,
    } as unknown as AdminFestival;
    const flag = {
      id: 'flg_1234567890',
      festivalId: base.id,
      name: 'Blue Flag',
      visibility: 'public',
      hidden: false,
      tags: ['sing'],
      bio: null,
      followerCount: 0,
      planVisible: true,
      plan: [],
      homeZoneId: null,
      photoUrl: null,
      thumbUrl: null,
      photoKey: null,
      thumbKey: null,
    } as unknown as Flag;
    const secondFlag = {
      ...flag,
      id: 'flg_abcdef1234567890',
      name: 'Red Flag',
    };
    const saveVersion = jest.fn().mockResolvedValue(undefined);
    const repositories = new Map<
      unknown,
      { findOne?: jest.Mock; save?: jest.Mock }
    >([
      [
        Flag,
        {
          findOne: jest
            .fn()
            .mockImplementation(({ where }: { where: { id: string } }) =>
              where.id === secondFlag.id ? secondFlag : flag,
            ),
        },
      ],
      [
        AdminFestival,
        {
          findOne: jest.fn().mockImplementation(() => festival),
          save: jest.fn().mockResolvedValue(undefined),
        },
      ],
      [AdminFestivalVersion, { save: saveVersion }],
    ]);
    const manager = {
      getRepository: (entity: unknown) => repositories.get(entity),
    };
    const transaction = jest.fn(
      (run: (value: typeof manager) => Promise<void>) => run(manager),
    );
    const db = { transaction } as unknown as DataSource;
    const invalidatePack = jest.fn().mockResolvedValue(undefined);
    const service = new FlagPackSyncService(db, { invalidatePack } as never);

    await service.sync(flag.id);
    expect(festival.publishedVersion).toBe(2);
    expect((festival.published?.flags as { id: string }[])[0].id).toBe(flag.id);
    expect(saveVersion).toHaveBeenCalledWith(
      expect.objectContaining({ festivalId: base.id, packVersion: 2 }),
    );

    flag.hidden = true;
    await service.sync(flag.id, manager as unknown as EntityManager);
    expect(festival.publishedVersion).toBe(3);
    expect(festival.published?.flags).toEqual([]);
    expect(transaction).toHaveBeenCalledTimes(1);

    flag.hidden = false;
    await service.syncMany(
      [flag.id, secondFlag.id],
      manager as unknown as EntityManager,
    );
    expect(festival.publishedVersion).toBe(4);
    expect(saveVersion).toHaveBeenCalledTimes(3);
    expect(festival.published?.flags).toHaveLength(2);
    expect(invalidatePack).toHaveBeenCalledTimes(1);
    expect(invalidatePack).toHaveBeenCalledWith(base.id);
  });

  describe('legacy free-text return times', () => {
    function setup() {
      const legacyDirections = {
        lastShuttleAt: '23:40',
        lastTrainAt: '막차 23시 52분',
        memo: '기존 메모',
      };
      const base = {
        id: 'fst_legacy01',
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
        flagsEnabled: true,
        stages: [{ id: 'stg_12345678', name: 'Main', order: 1 }],
        sets: [],
        zones: [],
        flags: [],
        checklist: [],
        rules: [],
        directions: legacyDirections,
        mapImageUrl: null,
        mapAspect: null,
        source: { name: 'Official', verifiedAt: '2026-11-18T12:00:00+09:00' },
      };
      const festival = {
        id: base.id,
        draft: { ...base },
        draftVersion: 1,
        published: { ...base, packVersion: 1 },
        publishedVersion: 1,
      } as unknown as AdminFestival;
      const flag = {
        id: 'flg_legacy0001',
        festivalId: base.id,
        name: 'Blue Flag',
        visibility: 'public',
        hidden: false,
        tags: [],
        bio: null,
        followerCount: 0,
        planVisible: true,
        plan: [],
        homeZoneId: null,
        photoUrl: null,
        thumbUrl: null,
        photoKey: null,
        thumbKey: null,
      } as unknown as Flag;
      const saveVersion = jest.fn().mockResolvedValue(undefined);
      const repositories = new Map<unknown, object>([
        [Flag, { findOne: jest.fn().mockResolvedValue(flag) }],
        [
          AdminFestival,
          {
            findOne: jest.fn().mockResolvedValue(festival),
            save: jest.fn().mockResolvedValue(undefined),
          },
        ],
        [AdminFestivalVersion, { save: saveVersion }],
      ]);
      const manager = {
        getRepository: (entity: unknown) => repositories.get(entity),
      };
      const db = {
        transaction: (run: (value: typeof manager) => Promise<void>) =>
          run(manager),
      } as unknown as DataSource;
      const service = new FlagPackSyncService(db, {
        invalidatePack: jest.fn().mockResolvedValue(undefined),
      } as never);
      return { service, festival, flag, manager, saveVersion };
    }

    const normalized = {
      lastShuttleAt: null,
      lastTrainAt: null,
      memo: '기존 메모',
    };

    it('lets a flag edit sync the pack and nulls the legacy values', async () => {
      const { service, festival, flag, saveVersion } = setup();
      await expect(service.sync(flag.id)).resolves.toEqual([festival.id]);
      expect(festival.draft.directions).toEqual(normalized);
      expect(festival.published?.directions).toEqual(normalized);
      expect(saveVersion).toHaveBeenCalledWith(
        expect.objectContaining({ packVersion: 2 }),
      );
    });

    it('lets account withdrawal re-sync flags inside its transaction', async () => {
      const { service, festival, flag, manager } = setup();
      flag.name = '이전된 깃발';
      await expect(
        service.syncMany([flag.id], manager as unknown as EntityManager),
      ).resolves.toEqual([festival.id]);
      expect(festival.published?.flags).toEqual([
        expect.objectContaining({ id: flag.id, name: '이전된 깃발' }),
      ]);
      expect(festival.draft.directions).toEqual(normalized);
      expect(festival.published?.directions).toEqual(normalized);
    });
  });
});
