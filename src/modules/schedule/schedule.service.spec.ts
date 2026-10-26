import { BadRequestException, ConflictException } from '@nestjs/common';
import { ScheduleService } from './schedule.service';

describe('ScheduleService', () => {
  const schedules = {
    create: jest.fn((value: unknown) => value),
    findOne: jest.fn(),
  };
  const festivals = {
    findOne: jest.fn().mockResolvedValue({
      publishedVersion: 1,
      published: { sets: [{ id: 'set_a1b2c3d4' }] },
    }),
  };
  const repo = { findOne: jest.fn(), save: jest.fn() };
  const manager = {
    query: jest.fn(),
    getRepository: jest.fn((entity: { name: string }) =>
      entity.name === 'AdminFestival' ? festivals : repo,
    ),
  };
  const db = {
    transaction: jest.fn((fn: (value: unknown) => unknown) => fn(manager)),
  };
  const liveActivity = { enqueueUser: jest.fn().mockResolvedValue(undefined) };
  const service = new ScheduleService(
    schedules as never,
    festivals as never,
    db as never,
    liveActivity as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    festivals.findOne.mockResolvedValue({
      publishedVersion: 1,
      published: { sets: [{ id: 'set_a1b2c3d4' }] },
    });
    manager.query.mockResolvedValue([{ id: 'user' }]);
    repo.findOne.mockResolvedValue(null);
    repo.save.mockImplementation((value: Record<string, unknown>) =>
      Promise.resolve({
        ...value,
        updatedAt: new Date('2026-10-20T03:00:00Z'),
      }),
    );
  });

  it('rejects a schedule with unpublished set IDs atomically', async () => {
    await expect(
      service.replace('user', 'fst_festival', {
        setIds: ['set_missing'],
        clientAt: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
    expect(liveActivity.enqueueUser).not.toHaveBeenCalled();
  });

  it('rejects a stale offline replay', async () => {
    repo.findOne.mockResolvedValue({
      setIds: ['set_a1b2c3d4'],
      clientAt: new Date('2026-10-20T02:00:00Z'),
      updatedAt: new Date('2026-10-20T02:00:00Z'),
    });
    await expect(
      service.replace('user', 'fst_festival', {
        setIds: [],
        clientAt: '2026-10-20T01:00:00Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
    expect(liveActivity.enqueueUser).not.toHaveBeenCalled();
  });

  it('saves an empty list to clear the schedule', async () => {
    const result = await service.replace('user', 'fst_festival', {
      setIds: [],
      clientAt: '2026-10-20T02:00:00Z',
    });
    expect(result).toEqual({
      setIds: [],
      updatedAt: '2026-10-20T03:00:00.000Z',
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user',
        festivalId: 'fst_festival',
        setIds: [],
      }),
    );
    expect(liveActivity.enqueueUser).toHaveBeenCalledWith(
      'user',
      'fst_festival',
      manager,
    );
  });

  it('returns the saved result without writing for an identical replay', async () => {
    repo.findOne.mockResolvedValue({
      setIds: ['set_a1b2c3d4'],
      clientAt: new Date('2026-10-20T02:00:00Z'),
      updatedAt: new Date('2026-10-20T03:00:00Z'),
    });
    const result = await service.replace('user', 'fst_festival', {
      setIds: ['set_a1b2c3d4'],
      clientAt: '2026-10-20T02:00:00Z',
    });
    expect(result.updatedAt).toBe('2026-10-20T03:00:00.000Z');
    expect(repo.save).not.toHaveBeenCalled();
    expect(liveActivity.enqueueUser).not.toHaveBeenCalled();
  });

  it('rejects different content with the same timestamp', async () => {
    repo.findOne.mockResolvedValue({
      setIds: ['set_a1b2c3d4'],
      clientAt: new Date('2026-10-20T02:00:00Z'),
      updatedAt: new Date('2026-10-20T03:00:00Z'),
    });
    await expect(
      service.replace('user', 'fst_festival', {
        setIds: [],
        clientAt: '2026-10-20T02:00:00Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(liveActivity.enqueueUser).not.toHaveBeenCalled();
  });
});
