import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeviceService } from './device.service';

describe('DeviceService ownership', () => {
  const id = 'aa9ad155-9145-46e7-9dd4-eb172dc522d1';
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
    save: jest.fn(),
  };
  const subscriptions = { find: jest.fn(), save: jest.fn(), delete: jest.fn() };
  const festivals = { findOne: jest.fn() };
  const users = { findOne: jest.fn() };
  const jwt = { verifyAsync: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('test-secret') };
  const service = new DeviceService(
    devices as never,
    subscriptions as never,
    festivals as never,
    users as never,
    jwt as never,
    config as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    subscriptions.find.mockResolvedValue([]);
    devices.insert.mockResolvedValue(undefined);
    devices.update.mockResolvedValue({ affected: 1 });
    devices.delete.mockResolvedValue({ affected: 1 });
    subscriptions.delete.mockResolvedValue({ affected: 1 });
    devices.save.mockImplementation((value: unknown) => Promise.resolve(value));
    users.findOne.mockResolvedValue({ id: 'user-a', provider: 'google' });
  });

  it('rejects an invalid bearer token', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('bad signature'));
    await expect(service.optionalUser('Bearer invalid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a malformed device ID before registration', async () => {
    await expect(
      service.register('not-a-uuid', body, null),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(devices.insert).not.toHaveBeenCalled();
  });

  it('returns device metadata without tokens and deletes only with ownership proof', async () => {
    const secret = 'a'.repeat(64);
    devices.findOne.mockResolvedValue({
      id,
      userId: null,
      appVersion: body.appVersion,
      osVersion: body.osVersion,
      locale: body.locale,
      timezone: body.timezone,
      apnsEnvironment: 'sandbox',
      apnsToken: body.apnsToken,
    });
    await expect(service.remove(id, null)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const info = await service.get(id, null, secret);
    expect(info).not.toHaveProperty('apnsToken');
    expect(info).not.toHaveProperty('deviceSecretHash');
    await service.remove(id, null, secret);
    expect(devices.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id }),
    );
  });

  it('rejects user B and anonymous takeover without device proof', async () => {
    devices.findOne.mockResolvedValue({
      id,
      userId: 'user-a',
      apnsToken: body.apnsToken,
    });
    const replacement = { ...body, apnsToken: 'b'.repeat(64) };
    await expect(
      service.register(id, replacement, 'user-b'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.register(id, replacement, null),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(devices.update).not.toHaveBeenCalled();
    expect(devices.insert).not.toHaveBeenCalled();
    expect(devices.save).not.toHaveBeenCalled();
  });

  it('issues an anonymous device secret once and requires it for later registration', async () => {
    devices.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id, userId: null });
    const registration = await service.register(id, body, null);
    expect(registration.deviceSecret).toMatch(/^[0-9a-f]{64}$/);
    const hash = createHash('sha256')
      .update(registration.deviceSecret!, 'hex')
      .digest('hex');
    expect(devices.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        userId: null,
        deviceSecretHash: hash,
      }),
    );
    await expect(
      service.register(id, { ...body, apnsToken: 'b'.repeat(64) }, null),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(devices.update).not.toHaveBeenCalled();
    await expect(
      service.register(id, body, null, registration.deviceSecret),
    ).resolves.toMatchObject({ deviceId: id, userId: null });
    expect(devices.update).toHaveBeenCalledWith(
      expect.objectContaining({ id, deviceSecretHash: hash }),
      expect.objectContaining({ apnsToken: body.apnsToken, userId: null }),
    );
  });

  it('requires proof to claim an anonymous device and mutate live activity or subscriptions', async () => {
    devices.findOne.mockResolvedValue({ id, userId: null });
    await expect(service.register(id, body, 'user-b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.stopLiveActivity(id, null)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.subscribe(
        id,
        'fst_test',
        { packUpdates: true, festivalStarts: true },
        null,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(devices.save).not.toHaveBeenCalled();
    expect(subscriptions.save).not.toHaveBeenCalled();
    await service.register(id, body, 'user-b', 'c'.repeat(64));
    expect(devices.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        deviceSecretHash: createHash('sha256')
          .update('c'.repeat(64), 'hex')
          .digest('hex'),
      }),
      expect.objectContaining({ userId: 'user-b' }),
    );
  });

  it('allows anonymous live activity and subscription only with matching device proof', async () => {
    const secret = 'd'.repeat(64);
    const hash = createHash('sha256').update(secret, 'hex').digest('hex');
    devices.findOne.mockImplementation(
      (options: { where: { deviceSecretHash?: string } }) =>
        Promise.resolve(
          options.where.deviceSecretHash === undefined ||
            options.where.deviceSecretHash === hash
            ? { id, userId: null }
            : null,
        ),
    );
    festivals.findOne.mockResolvedValue({
      published: true,
      publishedVersion: 1,
    });
    await expect(
      service.stopLiveActivity(id, null, 'e'.repeat(64)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await service.startLiveActivity(
      id,
      {
        festivalId: 'fst_test',
        activityId: 'activity',
        pushToken: 'f'.repeat(64),
      },
      null,
      secret,
    );
    await service.subscribe(
      id,
      'fst_test',
      { packUpdates: true, festivalStarts: true },
      null,
      secret,
    );
    expect(devices.update).toHaveBeenCalledWith(
      expect.objectContaining({ id, deviceSecretHash: hash }),
      expect.objectContaining({ liveActivityId: 'activity' }),
    );
    expect(subscriptions.save).toHaveBeenCalledWith({
      deviceId: id,
      festivalId: 'fst_test',
      packUpdates: true,
      festivalStarts: true,
    });
  });

  it('blocks live activity and subscription mutation by user B', async () => {
    devices.findOne.mockResolvedValue({ id, userId: 'user-a' });
    await expect(service.stopLiveActivity(id, 'user-b')).rejects.toBeInstanceOf(
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
    expect(devices.save).not.toHaveBeenCalled();
    expect(subscriptions.save).not.toHaveBeenCalled();
  });

  it('allows a device owner to move the device to another account with its secret', async () => {
    const secret = 'e'.repeat(64);
    const hash = createHash('sha256').update(secret, 'hex').digest('hex');
    devices.findOne.mockResolvedValue({ id, userId: 'user-a' });
    await expect(
      service.register(id, body, 'user-b', secret),
    ).resolves.toMatchObject({
      deviceId: id,
      userId: 'user-b',
    });
    expect(devices.update).toHaveBeenCalledWith(
      { id, userId: 'user-a', deviceSecretHash: hash },
      expect.objectContaining({ userId: 'user-b' }),
    );
  });

  it('keeps the linked account and push-to-start token on an anonymous refresh that omits it', async () => {
    const secret = 'f'.repeat(64);
    devices.findOne.mockResolvedValue({ id, userId: 'user-a' });
    const result = await service.register(id, body, null, secret);
    expect(result.userId).toBe('user-a');
    expect(devices.update).toHaveBeenCalledWith(
      expect.objectContaining({ id, userId: 'user-a' }),
      expect.objectContaining({ userId: 'user-a' }),
    );
    const [, updatedValues] = devices.update.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(updatedValues).not.toHaveProperty('liveActivityPushToStartToken');
  });

  it('rejects a bearer token for a deleted account', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: id,
      typ: 'access',
      provider: 'google',
    });
    users.findOne.mockResolvedValue(null);
    await expect(service.optionalUser(`Bearer token`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
