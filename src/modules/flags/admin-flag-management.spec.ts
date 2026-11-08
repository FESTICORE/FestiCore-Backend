import { HttpException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  AdminAuditInput,
  AdminAuditService,
} from '../admin/audit/admin-audit.service';
import { AdminFestival } from '../admin/festival/festival.entity';
import { Flag } from './flag.entity';
import { validateAdminFlagInput } from './flag-rules';
import { FlagPackSyncService } from './flag-pack-sync.service';
import { FlagsService } from './flags.service';

async function errorCode(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error instanceof HttpException
      ? (error.getResponse() as { code?: unknown }).code
      : error;
  }
  return 'NO_ERROR';
}

describe('관리자 깃발 입력 검증', () => {
  it('생성은 name과 tags가 필요하다', () => {
    expect(() =>
      validateAdminFlagInput({ name: '호락호락' }, 'create'),
    ).toThrow('name과 tags가 필요합니다.');
  });

  it('편집은 바꿀 필드가 필요하다', () => {
    expect(() => validateAdminFlagInput({}, 'update')).toThrow(
      '수정할 필드가 필요합니다.',
    );
  });

  it('https가 아닌 사진 URL과 허용되지 않은 필드를 거절한다', () => {
    expect(() =>
      validateAdminFlagInput({ photoUrl: 'http://x.test/a.jpg' }, 'update'),
    ).toThrow('photoUrl은 500자 이하의 https URL이어야 합니다.');
    expect(() =>
      validateAdminFlagInput({ followerCount: 1284 }, 'update'),
    ).toThrow('허용되지 않은 프로필 필드입니다.');
  });

  it('사진 URL을 바꾸면 썸네일을 같은 URL로 두고 업로드 사진 키를 지운다', () => {
    expect(
      validateAdminFlagInput({ photoUrl: 'https://x.test/a.jpg' }, 'update'),
    ).toEqual({
      photoUrl: 'https://x.test/a.jpg',
      thumbUrl: 'https://x.test/a.jpg',
      photoKey: null,
      thumbKey: null,
    });
  });
});

describe('관리자 깃발 생성·편집', () => {
  function setup(options: { existingName?: boolean; flag?: Flag } = {}) {
    const festival = {
      id: 'fst_1',
      draft: {},
      published: {
        zones: [{ id: 'zone_main' }],
        sets: [{ id: 'set_1' }, { id: 'set_2' }],
      },
    };
    const savedFlags: Flag[] = [];
    const flagRepository = {
      exists: jest.fn().mockResolvedValue(options.existingName ?? false),
      create: jest.fn((value: Partial<Flag>) =>
        Object.assign(new Flag(), value),
      ),
      save: jest.fn((flag: Flag) => {
        const saved = Object.assign(flag, {
          createdAt: flag.createdAt ?? new Date('2026-11-08T00:00:00.000Z'),
        });
        savedFlags.push(saved);
        return Promise.resolve(saved);
      }),
      findOne: jest.fn().mockResolvedValue(options.flag ?? null),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Flag) return flagRepository;
        if (entity === AdminFestival)
          return { findOne: jest.fn().mockResolvedValue(festival) };
        throw new Error('unexpected repository');
      }),
    } as unknown as EntityManager;
    const transaction = jest.fn(
      (work: (manager: EntityManager) => Promise<unknown>) => work(manager),
    );
    const record = jest
      .fn<Promise<void>, [EntityManager, AdminAuditInput]>()
      .mockResolvedValue(undefined);
    const sync = jest.fn().mockResolvedValue(['fst_1']);
    const invalidatePacks = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(FlagsService.prototype) as FlagsService;
    Reflect.set(service, 'db', { transaction } as unknown as DataSource);
    Reflect.set(service, 'adminAudit', {
      record,
    } as unknown as AdminAuditService);
    Reflect.set(service, 'packSync', {
      sync,
      invalidatePacks,
    } as unknown as FlagPackSyncService);
    Reflect.set(service, 'config', { get: () => undefined });
    return {
      service,
      manager,
      flagRepository,
      savedFlags,
      record,
      sync,
      invalidatePacks,
    };
  }

  const createInput = {
    name: '호락호락',
    bio: '처음 와도 괜찮아요.',
    tags: ['slam', 'sing', 'newbie'],
    photoUrl: 'https://x.test/a.jpg',
    homeZoneId: 'zone_main',
    plan: ['set_1', 'set_2'],
    planVisible: false,
  };

  it('기수 없는 예정 깃발을 만들고 감사 기록과 팩 갱신을 같은 트랜잭션에서 한다', async () => {
    const { service, manager, savedFlags, record, sync, invalidatePacks } =
      setup();

    const result = await service.adminCreate('fst_1', createInput, 'adm_1');

    const flag = savedFlags[0];
    expect(flag).toMatchObject({
      festivalId: 'fst_1',
      name: '호락호락',
      tags: ['slam', 'sing', 'newbie'],
      plan: ['set_1', 'set_2'],
      planVisible: false,
      homeZoneId: 'zone_main',
      photoUrl: 'https://x.test/a.jpg',
      thumbUrl: 'https://x.test/a.jpg',
      ownerId: null,
      followerCount: 0,
      status: 'scheduled',
      hidden: false,
      visibility: 'public',
    });
    expect(flag.id).toMatch(/^flg_[0-9a-f]{10}$/);
    expect(record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        actor: 'adm_1',
        action: 'flag.created',
        target: `flag:${flag.id}`,
        before: null,
      }),
    );
    expect(sync).toHaveBeenCalledWith(flag.id, manager);
    expect(invalidatePacks).toHaveBeenCalledWith(['fst_1']);
    // 계획 비공개여도 관리자 응답에는 전체 계획이 있다.
    expect(result).toMatchObject({
      plan: ['set_1', 'set_2'],
      planVisible: false,
      status: { status: 'scheduled', zoneId: null, activity: null },
    });
  });

  it('같은 축제에 같은 이름이 있으면 FLAG_NAME_TAKEN으로 막는다', async () => {
    const { service, record } = setup({ existingName: true });

    expect(
      await errorCode(service.adminCreate('fst_1', createInput, 'adm_1')),
    ).toBe('FLAG_NAME_TAKEN');
    expect(record).not.toHaveBeenCalled();
  });

  it('팩에 없는 존과 셋을 거절한다', async () => {
    const { service } = setup();

    expect(
      await errorCode(
        service.adminCreate(
          'fst_1',
          { ...createInput, homeZoneId: 'zone_x' },
          'adm_1',
        ),
      ),
    ).toBe('ZONE_NOT_FOUND');
    await expect(
      service.adminCreate(
        'fst_1',
        { ...createInput, plan: ['set_x'] },
        'adm_1',
      ),
    ).rejects.toThrow('plan에 없는 셋이 포함되었습니다.');
  });

  it('편집은 바뀐 필드의 이전·이후 값만 감사 기록하고 팩을 갱신한다', async () => {
    const flag = Object.assign(new Flag(), {
      id: 'flg_1',
      festivalId: 'fst_1',
      name: '호락호락',
      tags: ['slam'],
      plan: ['set_1'],
      planVisible: true,
      status: 'scheduled' as const,
      zoneId: null,
      activity: null,
      statusUpdatedAt: null,
      createdAt: new Date('2026-11-08T00:00:00.000Z'),
    });
    const { service, manager, record, sync } = setup({ flag });

    const result = await service.adminUpdate(
      'flg_1',
      { plan: ['set_1', 'set_2'], planVisible: false },
      'adm_1',
    );

    expect(record).toHaveBeenCalledWith(manager, {
      actor: 'adm_1',
      action: 'flag.updated',
      target: 'flag:flg_1',
      before: { plan: ['set_1'], planVisible: true },
      after: { plan: ['set_1', 'set_2'], planVisible: false },
    });
    expect(sync).toHaveBeenCalledWith('flg_1', manager);
    expect(result).toMatchObject({
      plan: ['set_1', 'set_2'],
      planVisible: false,
    });
  });

  it('없는 깃발 편집은 404다', async () => {
    const { service, record } = setup();

    expect(
      await errorCode(
        service.adminUpdate('flg_x', { planVisible: false }, 'adm_1'),
      ),
    ).toBe('NOT_FOUND');
    expect(record).not.toHaveBeenCalled();
  });
});
