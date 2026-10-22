import { DataSource, EntityManager } from 'typeorm';
import {
  AdminAuditInput,
  AdminAuditService,
} from '../admin/audit/admin-audit.service';
import { AdminFestival } from '../admin/festival/festival.entity';
import { Flag, FlagStatusEvent } from './flag.entity';
import { FlagsService } from './flags.service';

describe('관리자 깃발 상태 강제 변경', () => {
  function setup(zoneIds = ['zone_main']) {
    const flag: Flag = Object.assign(new Flag(), {
      id: 'flg_1',
      festivalId: 'fst_1',
      status: 'scheduled' as const,
      zoneId: null,
      activity: null,
      statusUpdatedAt: null,
      createdAt: new Date('2026-10-20T00:00:00.000Z'),
      restartDate: null,
    });
    const saveFlag = jest.fn().mockResolvedValue(flag);
    const saveEvent = jest.fn().mockResolvedValue(undefined);
    const getOne = jest.fn().mockResolvedValue(flag);
    const query = { setLock: jest.fn(), where: jest.fn(), getOne };
    query.setLock.mockReturnValue(query);
    query.where.mockReturnValue(query);
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Flag)
          return { createQueryBuilder: () => query, save: saveFlag };
        if (entity === FlagStatusEvent) return { save: saveEvent };
        if (entity === AdminFestival)
          return {
            findOne: jest.fn().mockResolvedValue({
              published: { zones: zoneIds.map((id) => ({ id })) },
            }),
          };
        throw new Error('unexpected repository');
      }),
    } as unknown as EntityManager;
    const transaction = jest.fn(
      (work: (manager: EntityManager) => Promise<unknown>) => work(manager),
    );
    const record = jest
      .fn<Promise<void>, [EntityManager, AdminAuditInput]>()
      .mockResolvedValue(undefined);
    const service = Object.create(FlagsService.prototype) as FlagsService;
    Reflect.set(service, 'db', { transaction } as unknown as DataSource);
    Reflect.set(service, 'adminAudit', {
      record,
    } as unknown as AdminAuditService);
    return { service, manager, flag, transaction, saveFlag, saveEvent, record };
  }

  it('상태·이벤트·감사 기록을 같은 트랜잭션에 저장한다', async () => {
    const { service, manager, transaction, saveFlag, saveEvent, record } =
      setup();
    const result = await service.forceStatus('flg_1', 'admin_1', {
      status: 'active',
      zoneId: 'zone_main',
      activity: 'sing',
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(saveFlag).toHaveBeenCalledTimes(1);
    expect(saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        flagId: 'flg_1',
        userId: null,
        status: 'active',
      }),
    );
    expect(record.mock.calls[0][0]).toBe(manager);
    expect(record.mock.calls[0][1]).toMatchObject({
      actor: 'admin_1',
      action: 'flag.force-status',
      target: 'flag:flg_1',
    });
    expect(record.mock.calls[0][1].before).toMatchObject({
      status: 'scheduled',
    });
    expect(record.mock.calls[0][1].after).toMatchObject({ status: 'active' });
    expect(result).toMatchObject({
      status: 'active',
      zoneId: 'zone_main',
      activity: 'sing',
    });
  });

  it('발행된 축제에 없는 존은 상태를 저장하지 않는다', async () => {
    const { service, saveFlag, saveEvent, record } = setup([]);
    await expect(
      service.forceStatus('flg_1', 'admin_1', {
        status: 'active',
        zoneId: 'zone_unknown',
        activity: 'sing',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(saveFlag).not.toHaveBeenCalled();
    expect(saveEvent).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('감사 기록 실패 시 트랜잭션 오류를 호출자에게 전파한다', async () => {
    const { service, record } = setup();
    record.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(
      service.forceStatus('flg_1', 'admin_1', {
        status: 'ended',
        zoneId: null,
        activity: null,
      }),
    ).rejects.toThrow('audit unavailable');
  });

  it('기수의 하루 한 번 재시작 제한 표식을 보존한다', async () => {
    const { service, flag } = setup();
    flag.restartDate = '2026-10-21';
    await service.forceStatus('flg_1', 'admin_1', {
      status: 'ended',
      zoneId: null,
      activity: null,
    });
    expect(flag.restartDate).toBe('2026-10-21');
  });
});
