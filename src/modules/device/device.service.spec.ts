import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DeviceService } from './device.service';

describe('DeviceService Bearer ownership', () => {
  const id = 'aa9ad155-9145-46e7-9dd4-eb172dc522d1';
  const userId = 'user-a';
  const body = {
    apnsToken: 'a'.repeat(64),
    appVersion: '1.0.0',
    osVersion: '18.0',
    locale: 'ko-KR',
    timezone: 'Asia/Seoul',
    apnsEnvironment: 'sandbox' as const,
  };
  const devices = {
    findOne: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const subscriptions = { find: jest.fn(), save: jest.fn(), delete: jest.fn() };
  const festivals = { findOne: jest.fn() };
  const service = new DeviceService(
    devices as never,
    subscriptions as never,
    festivals as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    subscriptions.find.mockResolvedValue([]);
    devices.insert.mockResolvedValue(undefined);
    devices.update.mockResolvedValue({ affected: 1 });
    devices.delete.mockResolvedValue({ affected: 1 });
    festivals.findOne.mockResolvedValue({
      published: true,
      publishedVersion: 1,
    });
  });

  it('rejects an invalid device ID before registration', async () => {
    await expect(
      service.register('invalid', body, userId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(devices.insert).not.toHaveBeenCalled();
  });

  it('registers a new device for the authenticated user without a secret', async () => {
    devices.findOne.mockResolvedValue(null);
    const result = await service.register(id, body, userId);
    expect(result).toEqual({ deviceId: id, userId, subscriptions: [] });
    expect(devices.insert).toHaveBeenCalledWith({
      id,
      userId,
      liveActivityPushToStartToken: null,
      ...body,
    });
  });

  it('updates only a device owned by the authenticated user', async () => {
    devices.findOne.mockResolvedValue({ id, userId });
    await service.register(id, { ...body, apnsToken: 'b'.repeat(64) }, userId);
    expect(devices.update).toHaveBeenCalledWith(
      { id, userId },
      { ...body, apnsToken: 'b'.repeat(64) },
    );
  });

  it.each(['user-b', null])(
    'blocks an account from taking over a device owned by %s',
    async (owner) => {
      devices.findOne.mockResolvedValue({ id, userId: owner });
      await expect(service.register(id, body, userId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(devices.update).not.toHaveBeenCalled();
    },
  );

  it('returns safe metadata and deletes with an owner-scoped condition', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId,
      ...body,
      liveActivityPushToken: 'private',
    });
    const info = await service.get(id, userId);
    expect(info).not.toHaveProperty('apnsToken');
    expect(info).not.toHaveProperty('liveActivityPushToken');
    await service.remove(id, userId);
    expect(devices.delete).toHaveBeenCalledWith({ id, userId });
  });

  it('blocks another user from device and subscription operations', async () => {
    devices.findOne.mockResolvedValue({ id, userId });
    await expect(service.get(id, 'user-b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.remove(id, 'user-b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.subscribe(
        id,
        'fst_test',
        { packUpdates: true, festivalStarts: true },
        'user-b',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(devices.delete).not.toHaveBeenCalled();
    expect(subscriptions.save).not.toHaveBeenCalled();
  });

  it('allows owned Live Activity and subscriptions without a device secret', async () => {
    devices.findOne.mockResolvedValue({ id, userId });
    await service.startLiveActivity(
      id,
      {
        festivalId: 'fst_test',
        activityId: 'activity',
        pushToken: 'f'.repeat(64),
      },
      userId,
    );
    expect(devices.update).toHaveBeenCalledWith(
      { id, userId },
      expect.objectContaining({ liveActivityId: 'activity' }),
    );
    await service.subscribe(
      id,
      'fst_test',
      { packUpdates: true, festivalStarts: true },
      userId,
    );
    expect(subscriptions.save).toHaveBeenCalledWith({
      deviceId: id,
      festivalId: 'fst_test',
      packUpdates: true,
      festivalStarts: true,
    });
    await expect(service.listSubscriptions(id, userId)).resolves.toEqual({
      items: [],
    });
  });
});
