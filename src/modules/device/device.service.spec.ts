import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DeviceService } from './device.service';
import type { DevicePrincipal } from './device-auth.guard';

describe('DeviceService ownership and pins', () => {
  const id = 'aa9ad155-9145-46e7-9dd4-eb172dc522d1';
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
  };
  const config = { get: jest.fn().mockReturnValue('test-secret') };
  const dataSource = { query: jest.fn().mockResolvedValue([{ count: 1 }]) };
  const service = new DeviceService(
    devices as never,
    subscriptions as never,
    festivals as never,
    jwt as never,
    config as never,
    dataSource as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions.find.mockResolvedValue([]);
    subscriptions.findOne.mockResolvedValue(null);
    devices.update.mockResolvedValue({ affected: 1 });
    devices.delete.mockResolvedValue({ affected: 1 });
    festivals.findOne.mockResolvedValue({
      published: true,
      publishedVersion: 1,
    });
    dataSource.query.mockResolvedValue([{ count: 1 }]);
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

  it('rotates a matching device token on registration', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId: null,
      deviceTokenId: 'token-a',
    });
    const result = await service.register(id, body, device);
    expect(result).toHaveProperty('deviceAccessToken', 'issued-device-token');
    const [condition, values] = devices.update.mock.calls[0] as [
      { id: string; deviceTokenId: string },
      { deviceTokenId: string },
    ];
    expect(condition).toEqual({ id, deviceTokenId: 'token-a' });
    expect(typeof values.deviceTokenId).toBe('string');
    expect(values.deviceTokenId).not.toBe('token-a');
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
    });
    expect(subscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: id,
        festivalId: 'fst_test',
        pinned: false,
        pinnedAt: null,
        packDownloadedVersion: 2,
      }),
    );
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
