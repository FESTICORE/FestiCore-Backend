import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
import { DeviceService } from './device.service';
import type { DevicePrincipal } from './device-auth.guard';

describe('DeviceService ownership and pins', () => {
  const id = 'aa9ad155-9145-46e7-9dd4-eb172dc522d1';
  const unbindKey = 'cac664e6-d768-4073-9acd-14d36b6ae01b';
  const user: DevicePrincipal = { kind: 'user', userId: 'user-a' };
  const anonymous: DevicePrincipal = { kind: 'anonymous' };
  const device: DevicePrincipal = {
    kind: 'device',
    deviceId: id,
    tokenId: 'token-a',
  };
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
    insert: jest.fn((values: { deviceTokenId: string | null }) => {
      void values;
      return Promise.resolve(undefined);
    }),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const subscriptions = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const festivals = { findOne: jest.fn() };
  const jwt = {
    signAsync: jest.fn((payload: { jti: string }) => {
      void payload;
      return Promise.resolve('issued-device-token');
    }),
    verifyAsync: jest.fn(),
  };
  const config = { get: jest.fn().mockReturnValue('test-secret') };
  const transactionManager = {
    delete: jest.fn(),
    update: jest.fn(),
    query: jest.fn(),
    findOne: jest.fn(),
  };
  const liveActivity = {
    enqueueDevice: jest.fn(),
    stopDevice: jest.fn(),
    endDeviceForUnbind: jest.fn(),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([{ count: 1 }]),
    transaction: jest.fn(
      (work: (manager: typeof transactionManager) => Promise<unknown>) =>
        work(transactionManager),
    ),
  };
  const service = new DeviceService(
    devices as never,
    subscriptions as never,
    festivals as never,
    jwt as never,
    config as never,
    dataSource as never,
    liveActivity as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions.find.mockResolvedValue([]);
    subscriptions.findOne.mockResolvedValue(null);
    devices.update.mockResolvedValue({ affected: 1 });
    devices.delete.mockResolvedValue({ affected: 1 });
    transactionManager.delete.mockResolvedValue({ affected: 1 });
    transactionManager.update.mockResolvedValue({ affected: 1 });
    transactionManager.query.mockResolvedValue([]);
    liveActivity.enqueueDevice.mockResolvedValue(undefined);
    liveActivity.stopDevice.mockResolvedValue(undefined);
    liveActivity.endDeviceForUnbind.mockResolvedValue(undefined);
    festivals.findOne.mockResolvedValue({
      published: true,
      publishedVersion: 1,
    });
    dataSource.query.mockResolvedValue([{ count: 1 }]);
    jwt.verifyAsync.mockResolvedValue({
      typ: 'device',
      sub: id,
      jti: 'token-a',
    });
  });

  it('binds a matching anonymous device token to the user and reserves it for recovery only', async () => {
    const result = await service.bindUser(id, 'device-secret', user);
    expect(result).toEqual({ deviceId: id, userId: user.userId });
    expect(jwt.verifyAsync).toHaveBeenCalledWith('device-secret', {
      secret: 'test-secret',
    });
    expect(devices.update).toHaveBeenCalledWith(
      expect.objectContaining({ id, deviceTokenId: 'token-a' }),
      { userId: user.userId },
    );
    const updateCalls = devices.update.mock.calls as unknown as Array<
      [{ userId: unknown }, unknown]
    >;
    const condition = updateCalls[0][0];
    expect(condition.userId).toEqual(
      expect.objectContaining({ _type: 'isNull' }),
    );
  });

  it('rejects anonymous, invalid, mismatched, or already claimed device bindings', async () => {
    await expect(
      service.bindUser(id, 'device-secret', device),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    jwt.verifyAsync.mockRejectedValueOnce(new Error('bad signature'));
    await expect(service.bindUser(id, 'bad', user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    jwt.verifyAsync.mockResolvedValueOnce({
      typ: 'device',
      sub: 'other',
      jti: 'token-a',
    });
    await expect(
      service.bindUser(id, 'wrong-device', user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    devices.update.mockResolvedValueOnce({ affected: 0 });
    await expect(
      service.bindUser(id, 'stale-device', user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(devices.update).toHaveBeenCalledTimes(1);
  });

  it('retries a completed bind only for the same user and original device credential', async () => {
    devices.update.mockResolvedValueOnce({ affected: 0 });
    devices.findOne.mockResolvedValueOnce({
      id,
      userId: user.userId,
      deviceTokenId: 'token-a',
    });
    await expect(service.bindUser(id, 'device-secret', user)).resolves.toEqual({
      deviceId: id,
      userId: user.userId,
    });
    devices.update.mockResolvedValueOnce({ affected: 0 });
    devices.findOne.mockResolvedValueOnce(null);
    await expect(
      service.bindUser(id, 'device-secret', user),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('unbinds only the authenticated owner and cancels pending performance starts atomically', async () => {
    const result = await service.unbindUser(id, unbindKey, user);
    expect(result).toMatchObject({
      deviceId: id,
      userId: null,
      deviceAccessToken: 'issued-device-token',
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(transactionManager.update).toHaveBeenCalledWith(
      expect.anything(),
      { id, userId: user.userId },
      expect.objectContaining({ userId: null }),
    );
    expect(transactionManager.query).toHaveBeenCalledWith(
      expect.stringContaining("'live-activity-performance:%'"),
      [id],
    );
    expect(liveActivity.endDeviceForUnbind).toHaveBeenCalledWith(
      id,
      transactionManager,
    );
    expect(transactionManager.update).toHaveBeenCalledWith(
      expect.anything(),
      { id, deviceTokenId: unbindKey },
      expect.objectContaining({
        apnsToken: null,
        liveActivityPushToStartToken: null,
        liveActivityPushToken: null,
        liveActivityFestivalId: null,
        liveActivityId: null,
      }),
    );
    const updateCalls = transactionManager.update.mock
      .calls as unknown as Array<[unknown, unknown, { deviceTokenId: string }]>;
    const values = updateCalls[0][2];
    expect(values.deviceTokenId).toBe(unbindKey);
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        typ: 'device',
        sub: id,
        jti: values.deviceTokenId,
      }),
      expect.objectContaining({ secret: 'test-secret' }),
    );
  });

  it('does not unbind with a device token or another user', async () => {
    await expect(
      service.unbindUser(id, unbindKey, device),
    ).rejects.toBeInstanceOf(ForbiddenException);
    transactionManager.update.mockResolvedValueOnce({ affected: 0 });
    await expect(
      service.unbindUser(id, unbindKey, { kind: 'user', userId: 'other' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transactionManager.query).not.toHaveBeenCalled();
    expect(liveActivity.endDeviceForUnbind).not.toHaveBeenCalled();
  });

  it('does not clear ownership or tokens when the remote Activity cannot be ended', async () => {
    liveActivity.endDeviceForUnbind.mockRejectedValueOnce(
      new Error('APNs unavailable'),
    );
    await expect(service.unbindUser(id, unbindKey, user)).rejects.toThrow(
      'APNs unavailable',
    );
    expect(transactionManager.update).toHaveBeenCalledTimes(1);
    expect(transactionManager.query).not.toHaveBeenCalled();
  });

  it('recovers an expired session with the original device credential and retries with the saved unbind key', async () => {
    const result = await service.recoverUnbindUser(id, unbindKey, device);
    expect(result.deviceAccessToken).toBe('issued-device-token');
    expect(transactionManager.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id, deviceTokenId: 'token-a' }),
      { userId: null, deviceTokenId: unbindKey },
    );
    expect(transactionManager.query).toHaveBeenCalledWith(
      expect.stringContaining("'live-activity-performance:%'"),
      [id],
    );
    transactionManager.update.mockResolvedValueOnce({ affected: 0 });
    transactionManager.findOne.mockResolvedValueOnce({
      id,
      userId: null,
      deviceTokenId: unbindKey,
    });
    await expect(
      service.recoverUnbindUser(id, unbindKey, anonymous),
    ).resolves.toMatchObject({ deviceAccessToken: 'issued-device-token' });
    transactionManager.findOne.mockResolvedValueOnce(null);
    await expect(
      service.recoverUnbindUser(
        id,
        '470c581d-bb9a-45ca-a0f7-0ac4fe1b65a8',
        anonymous,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reissues a device token only for the same persisted unbind key after a lost response', async () => {
    transactionManager.update.mockResolvedValue({ affected: 0 });
    transactionManager.findOne.mockResolvedValue({
      id,
      userId: null,
      deviceTokenId: unbindKey,
    });
    await expect(service.unbindUser(id, unbindKey, user)).resolves.toEqual({
      deviceId: id,
      userId: null,
      deviceAccessToken: 'issued-device-token',
    });
    const findOneCalls = transactionManager.findOne.mock
      .calls as unknown as Array<
      [unknown, { where: { id: string; deviceTokenId: string } }]
    >;
    expect(findOneCalls[0][1].where).toMatchObject({
      id,
      deviceTokenId: unbindKey,
    });
    expect(transactionManager.query).not.toHaveBeenCalled();
    transactionManager.findOne.mockResolvedValueOnce(null);
    await expect(
      service.unbindUser(id, '470c581d-bb9a-45ca-a0f7-0ac4fe1b65a8', user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.unbindUser(id, 'guess', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('enqueues activity registration in the same transaction as the owned device update', async () => {
    devices.findOne.mockResolvedValue({ id, userId: user.userId });
    await service.startLiveActivity(
      id,
      {
        festivalId: 'fst_one',
        activityId: 'activity-one',
        pushToken: 'a'.repeat(64),
      },
      user,
    );
    expect(transactionManager.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id, userId: user.userId }),
      expect.objectContaining({ liveActivityPushToken: 'a'.repeat(64) }),
    );
    expect(liveActivity.enqueueDevice).toHaveBeenCalledWith(
      id,
      transactionManager,
    );
  });

  it('invalidates delivery when an owned device stops its activity', async () => {
    devices.findOne.mockResolvedValue({ id, userId: user.userId });
    await service.stopLiveActivity(id, user);
    expect(liveActivity.stopDevice).toHaveBeenCalledWith(
      id,
      transactionManager,
    );
  });

  it('deletes a device and its metric events in one transaction', async () => {
    devices.findOne.mockResolvedValue({ id, userId: user.userId });
    await service.remove(id, user);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(transactionManager.delete).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ id }),
    );
    expect(transactionManager.query).toHaveBeenCalledWith(
      'DELETE FROM "metric_events" WHERE "deviceId" = $1',
      [id],
    );
  });

  it('rejects an invalid device ID before registration', async () => {
    await expect(
      service.register('invalid', body, anonymous),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(devices.insert).not.toHaveBeenCalled();
  });

  it('registers an anonymous device and issues a bound Bearer', async () => {
    devices.findOne.mockResolvedValue(null);
    const result = await service.register(id, body, anonymous);
    expect(result).toMatchObject({
      deviceId: id,
      userId: null,
      deviceAccessToken: 'issued-device-token',
    });
    expect(devices.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        userId: null,
      }),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        typ: 'device',
        sub: id,
      }),
      expect.objectContaining({ secret: 'test-secret' }),
    );
    const insert = devices.insert.mock.calls[0][0] as {
      deviceTokenId: unknown;
    };
    const payload = jwt.signAsync.mock.calls[0][0] as { jti: unknown };
    expect(typeof insert.deviceTokenId).toBe('string');
    expect(payload.jti).toBe(insert.deviceTokenId);
  });

  it('blocks UUID-only takeover of an existing device', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId: null,
      deviceTokenId: 'token-a',
    });
    await expect(service.register(id, body, anonymous)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.register(id, body, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(devices.update).not.toHaveBeenCalled();
  });

  it('keeps a matching device token valid when registration is retried', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId: null,
      deviceTokenId: 'token-a',
    });
    const result = await service.register(id, body, device);
    expect(result).toHaveProperty('deviceAccessToken', 'issued-device-token');
    const [condition, values] = devices.update.mock.calls[0] as [
      { id: string; deviceTokenId: string },
      Record<string, unknown>,
    ];
    expect(condition).toMatchObject({ id, deviceTokenId: 'token-a' });
    expect(values).not.toHaveProperty('deviceTokenId');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ jti: 'token-a' }),
      expect.any(Object),
    );
  });

  it('lets user Bearer update only its own device', async () => {
    devices.findOne.mockResolvedValue({ id, userId: 'user-a' });
    await service.register(id, body, user);
    expect(devices.update).toHaveBeenCalledWith(
      { id, userId: 'user-a' },
      expect.objectContaining(body),
    );
    await expect(
      service.get(id, { kind: 'user', userId: 'user-b' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns all notification kinds on for a device saved before settings existed', async () => {
    devices.findOne.mockResolvedValue({ id, userId: user.userId });
    await expect(service.notificationSettings(id, user)).resolves.toEqual({
      flagStatus: true,
      crewStatus: true,
      crewGather: true,
      setReminders: true,
      homecoming: true,
      packUpdates: true,
    });
  });

  it('updates only the sent notification kinds for the owned device', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId: null,
      deviceTokenId: 'token-a',
      notifyFlagStatus: true,
      notifyCrewStatus: true,
      notifyCrewGather: true,
      notifySetReminders: true,
      notifyHomecoming: true,
      notifyPackUpdates: true,
    });
    await expect(
      service.updateNotificationSettings(
        id,
        { crewGather: false, packUpdates: false },
        device,
      ),
    ).resolves.toEqual({
      flagStatus: true,
      crewStatus: true,
      crewGather: false,
      setReminders: true,
      homecoming: true,
      packUpdates: false,
    });
    expect(devices.update).toHaveBeenCalledWith(
      {
        id,
        userId: IsNull(),
        deviceTokenId: 'token-a',
      },
      { notifyCrewGather: false, notifyPackUpdates: false },
    );
  });

  it('does not write when no notification kind is sent', async () => {
    devices.findOne.mockResolvedValue({ id, userId: user.userId });
    await service.updateNotificationSettings(id, {}, user);
    expect(devices.update).not.toHaveBeenCalled();
  });

  it('rejects notification settings of another account device', async () => {
    devices.findOne.mockResolvedValue({ id, userId: 'user-a' });
    await expect(
      service.updateNotificationSettings(
        id,
        { flagStatus: false },
        { kind: 'user', userId: 'user-b' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.notificationSettings(id, anonymous),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(devices.update).not.toHaveBeenCalled();
  });

  it('keeps unpinned rows, preserves pack opt-in meaning and download version', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId: null,
      deviceTokenId: 'token-a',
    });
    subscriptions.findOne.mockResolvedValue({
      pinned: true,
      pinnedAt: new Date('2026-01-01'),
      packDownloadedVersion: 2,
      festivalStarts: true,
    });
    const result = await service.subscribe(
      id,
      'fst_test',
      { pinned: false },
      device,
    );
    expect(result).toMatchObject({
      pinned: false,
      pinnedAt: null,
      reminders: true,
      packUpdates: false,
      festivalStarts: true,
    });
    expect(subscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: id,
        festivalId: 'fst_test',
        pinned: false,
        pinnedAt: null,
        festivalStarts: true,
        packDownloadedVersion: 2,
      }),
    );
  });

  it('enables start notifications for a new pin without changing pack opt-in', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId: null,
      deviceTokenId: 'token-a',
    });
    const result = await service.subscribe(
      id,
      'fst_test',
      { pinned: true },
      device,
    );
    expect(result).toMatchObject({
      pinned: true,
      reminders: true,
      packUpdates: false,
      festivalStarts: true,
    });
  });

  it('keeps default start preference when first saved unpinned and later pinned', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId: null,
      deviceTokenId: 'token-a',
    });
    await expect(
      service.subscribe(id, 'fst_test', { pinned: false }, device),
    ).resolves.toMatchObject({ pinned: false, festivalStarts: true });
    subscriptions.findOne.mockResolvedValue({
      pinned: false,
      festivalStarts: true,
    });
    await expect(
      service.subscribe(id, 'fst_test', { pinned: true }, device),
    ).resolves.toMatchObject({ pinned: true, festivalStarts: true });
  });

  it('restores the start preference when an existing subscription is pinned again', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId: null,
      deviceTokenId: 'token-a',
    });
    subscriptions.findOne.mockResolvedValue({
      pinned: false,
      pinnedAt: null,
      reminders: true,
      packUpdates: false,
      festivalStarts: true,
    });
    await expect(
      service.subscribe(id, 'fst_test', { pinned: true }, device),
    ).resolves.toMatchObject({ pinned: true, festivalStarts: true });
  });

  it('limits subscription writes by the authenticated device ID', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId: null,
      deviceTokenId: 'token-a',
    });
    dataSource.query.mockResolvedValueOnce([]);
    await expect(
      service.subscribe(id, 'fst_test', { pinned: true }, device),
    ).rejects.toMatchObject({ status: 429 });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('device_subscription_rate_limits'),
      [id, expect.any(Number)],
    );
    expect(subscriptions.save).not.toHaveBeenCalled();
  });

  it('acknowledges download only for an existing owned subscription', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId: null,
      deviceTokenId: 'token-a',
    });
    await expect(
      service.acknowledgePackDownload(
        id,
        'fst_test',
        { packVersion: 2 },
        device,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    subscriptions.findOne.mockResolvedValue({
      deviceId: id,
      festivalId: 'fst_test',
    });
    await expect(
      service.acknowledgePackDownload(
        id,
        'fst_test',
        { packVersion: 2 },
        device,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subscriptions.update).not.toHaveBeenCalled();
    festivals.findOne.mockResolvedValue({
      published: true,
      publishedVersion: 2,
    });
    await service.acknowledgePackDownload(
      id,
      'fst_test',
      { packVersion: 2 },
      device,
    );
    expect(subscriptions.update).toHaveBeenCalledWith(
      { deviceId: id, festivalId: 'fst_test' },
      { packDownloadedVersion: 2 },
    );
  });
});
