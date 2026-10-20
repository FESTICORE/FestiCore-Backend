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
    } as AdminFestival;
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
    } as Flag;
    const secondFlag = {
      ...flag,
      id: 'flg_abcdef1234567890',
      name: 'Red Flag',
    };
    const saveVersion = jest.fn().mockResolvedValue(undefined);
    const repositories = new Map([
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
      getRepository: (entity: unknown) =>
        repositories.get(entity as typeof Flag),
    };
    const transaction = jest.fn(
      (run: (value: typeof manager) => Promise<void>) => run(manager),
    );
    const db = { transaction } as unknown as DataSource;
    const service = new FlagPackSyncService(db);

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
  });
});
