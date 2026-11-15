import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DeviceTestPushService } from './device-test-push.service';
import type { DevicePrincipal } from './device-auth.guard';

describe('DeviceTestPushService', () => {
  const deviceId = 'aa9ad155-9145-46e7-9dd4-eb172dc522d1';
  const festivalId = 'fst_test1';
  const principal: DevicePrincipal = { kind: 'user', userId: 'user-a' };
  const apnsToken = 'a'.repeat(64);
  const startToken = 'b'.repeat(64);
  const published = {
    name: '공개 축제',
    thumbUrl: 'https://cdn.example.com/poster.jpg',
    days: [
      {
        date: '2026-11-20',
        startsAt: '2026-11-20T12:00:00+09:00',
        endsAt: '2026-11-20T22:00:00+09:00',
      },
    ],
    sets: [],
  };

  function setup(
    options: {
      enabled?: string;
      environment?: string;
      tokens?: { apnsToken: string | null; start: string | null };
    } = {},
  ) {
    const devices = {
      findOne: jest.fn().mockResolvedValue({
        id: deviceId,
        apnsEnvironment: 'sandbox',
        apnsToken: options.tokens ? options.tokens.apnsToken : apnsToken,
        liveActivityPushToStartToken: options.tokens
          ? options.tokens.start
          : startToken,
      }),
    };
    const deviceService = {
      ownedDevice: jest.fn().mockResolvedValue({ id: deviceId }),
      publishedFestival: jest
        .fn()
        .mockResolvedValue({ id: festivalId, published, publishedVersion: 1 }),
    };
    const apns = {
      sendSetReminderNotification: jest
        .fn()
        .mockResolvedValue({ accepted: true, permanent: false }),
      sendLiveActivityStart: jest
        .fn()
        .mockResolvedValue({ accepted: true, permanent: false }),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'DEVICE_TEST_PUSH_ENABLED'
          ? 'enabled' in options
            ? options.enabled
            : 'true'
          : key === 'RAILWAY_ENVIRONMENT_NAME'
            ? options.environment
            : undefined,
      ),
    };
    const service = new DeviceTestPushService(
      devices as never,
      deviceService as never,
      apns as never,
      config as never,
    );
    return { service, devices, deviceService, apns };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-20T03:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it.each([undefined, 'false', 'TRUE'])(
    '플래그가 %s이면 라우트가 없는 것처럼 404를 낸다',
    async (enabled) => {
      const { service, deviceService, apns } = setup({
        enabled: enabled as string,
      });
      await expect(
        service.schedule(deviceId, { festivalId }, principal),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(deviceService.ownedDevice).not.toHaveBeenCalled();
      await jest.runAllTimersAsync();
      expect(apns.sendSetReminderNotification).not.toHaveBeenCalled();
    },
  );

  it('운영 환경에서는 플래그가 켜져 있어도 404를 낸다', async () => {
    const { service, deviceService } = setup({ environment: 'production' });
    await expect(
      service.schedule(deviceId, { festivalId }, principal),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deviceService.ownedDevice).not.toHaveBeenCalled();
  });

  it('다른 소유자의 기기는 403이고 발송을 예약하지 않는다', async () => {
    const { service, deviceService, apns } = setup();
    deviceService.ownedDevice.mockRejectedValueOnce(
      new ForbiddenException('기기 소유자가 다릅니다.'),
    );
    await expect(
      service.schedule(deviceId, { festivalId }, principal),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deviceService.publishedFestival).not.toHaveBeenCalled();
    await jest.runAllTimersAsync();
    expect(apns.sendSetReminderNotification).not.toHaveBeenCalled();
    expect(apns.sendLiveActivityStart).not.toHaveBeenCalled();
  });

  it('같은 기기는 60초에 한 번만 요청할 수 있다', async () => {
    const { service } = setup();
    await service.schedule(deviceId, { festivalId }, principal);
    await expect(
      service.schedule(deviceId, { festivalId }, principal),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'RATE_LIMITED' },
    });
    jest.setSystemTime(new Date('2026-11-20T03:01:00Z'));
    await expect(
      service.schedule(deviceId, { festivalId }, principal),
    ).resolves.toMatchObject({ deviceId });
  });

  it('지연 뒤 공연 알림과 Live Activity 원격 시작을 각각 보내고 응답에 토큰을 넣지 않는다', async () => {
    const { service, devices, apns } = setup();
    const response = await service.schedule(
      deviceId,
      { festivalId, delaySeconds: 30 },
      principal,
    );

    expect(response).toEqual({
      deviceId,
      festivalId,
      scheduledAt: '2026-11-20T03:00:30.000Z',
      alert: true,
      liveActivity: true,
    });
    expect(JSON.stringify(response)).not.toContain(apnsToken);
    expect(JSON.stringify(response)).not.toContain(startToken);
    expect(devices.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          apnsToken: true,
          liveActivityPushToStartToken: true,
        }) as unknown,
      }),
    );

    await jest.advanceTimersByTimeAsync(29_000);
    expect(apns.sendSetReminderNotification).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(apns.sendSetReminderNotification).toHaveBeenCalledWith(
      apnsToken,
      'sandbox',
      expect.objectContaining({
        festivalId,
        title: '공개 축제',
        body: '테스트 공연 알림이에요.',
        deeplink: `festicore://festival/${festivalId}`,
        festivalName: '공개 축제',
        imageUrl: 'https://cdn.example.com/poster.jpg',
      }),
    );
    expect(apns.sendLiveActivityStart).toHaveBeenCalledWith(
      startToken,
      'sandbox',
      expect.objectContaining({
        festivalId,
        festivalName: '공개 축제',
        alertBody: '테스트 Live Activity예요.',
        state: expect.objectContaining({
          phase: expect.any(String) as unknown,
        }) as unknown,
      }),
    );
  });

  it.each([
    ['알림 토큰', { apnsToken: null, start: startToken }],
    ['시작 토큰', { apnsToken, start: null }],
  ])('%s이 없으면 그 발송만 건너뛴다', async (_, tokens) => {
    const { service, apns } = setup({ tokens });
    const response = await service.schedule(
      deviceId,
      { festivalId, delaySeconds: 0 },
      principal,
    );
    expect(response.alert).toBe(tokens.apnsToken !== null);
    expect(response.liveActivity).toBe(tokens.start !== null);
    await jest.runAllTimersAsync();
    expect(apns.sendSetReminderNotification).toHaveBeenCalledTimes(
      tokens.apnsToken ? 1 : 0,
    );
    expect(apns.sendLiveActivityStart).toHaveBeenCalledTimes(
      tokens.start ? 1 : 0,
    );
  });

  it('한쪽 발송 예외가 다른 쪽 발송을 막지 않는다', async () => {
    const { service, apns } = setup();
    apns.sendSetReminderNotification.mockRejectedValueOnce(new Error('boom'));
    await service.schedule(
      deviceId,
      { festivalId, delaySeconds: 0 },
      principal,
    );
    await jest.runAllTimersAsync();
    expect(apns.sendLiveActivityStart).toHaveBeenCalledTimes(1);
  });
});
