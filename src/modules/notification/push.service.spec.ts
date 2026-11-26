import { ConfigService } from '@nestjs/config';
import { ApnsService, type PushMessage } from './apns.service';
import type { FcmService } from './fcm.service';
import { hasPushTarget, PushService, type PushTarget } from './push.service';

const IOS: PushTarget = {
  platform: 'ios',
  apnsToken: 'ab'.repeat(32),
  apnsEnvironment: 'production',
  fcmToken: null,
};
const ANDROID: PushTarget = {
  platform: 'android',
  apnsToken: null,
  apnsEnvironment: null,
  fcmToken: 'fcm-registration-token',
};
const OK = { accepted: true, permanent: false };

describe('PushService', () => {
  // 본문은 실제 ApnsService.build*로 만들고, 보내기만 가짜로 바꾼다.
  const config = { get: () => undefined } as unknown as ConfigService;
  const apns = new ApnsService(config);
  const sendMessage = jest.spyOn(apns, 'sendMessage');
  const apnsConfigured = jest.spyOn(apns, 'isConfigured');
  const fcm = { send: jest.fn(), isConfigured: jest.fn() };
  const service = new PushService(apns, fcm as unknown as FcmService);

  beforeEach(() => {
    jest.clearAllMocks();
    sendMessage.mockResolvedValue(OK);
    fcm.send.mockResolvedValue(OK);
    apnsConfigured.mockReturnValue(true);
    fcm.isConfigured.mockReturnValue(true);
  });

  it('sends iOS devices through APNs with the same body as before', async () => {
    const input = {
      title: '축제 시작',
      body: '지금 시작합니다',
      eventKey: 'festival-start:f1:2026-10-21',
    };
    await expect(service.sendStartNotification(IOS, input)).resolves.toEqual(
      OK,
    );
    expect(sendMessage).toHaveBeenCalledWith(
      IOS.apnsToken,
      'production',
      apns.buildStartNotification(input),
    );
    expect(fcm.send).not.toHaveBeenCalled();
  });

  it('sends Android devices through FCM with the same message', async () => {
    await service.sendPackUpdated(ANDROID, 'f1', 3);
    expect(fcm.send).toHaveBeenCalledWith(
      'fcm-registration-token',
      apns.buildPackUpdated('f1', 3),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('routes every visible notification kind by platform', async () => {
    const social = {
      type: 'crew.gather' as const,
      payload: { crewId: 'c1', gatherId: 'g1' },
      eventKey: 'crew-gather:g1',
    };
    const reminder = {
      festivalId: 'f1',
      title: 't',
      body: 'b',
      eventKey: 'festival-reminder:f1',
      hasPack: true,
    };
    const setReminder = {
      festivalId: 'f1',
      setId: 's1',
      title: 't',
      body: 'b',
      eventKey: 'set-reminder:f1:s1',
      deeplink: 'festicore://festivals/f1/sets/s1',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    };
    for (const target of [IOS, ANDROID]) {
      await service.sendReminderNotification(target, reminder);
      await service.sendSetReminderNotification(target, setReminder);
      await service.sendSocialNotification(target, social);
      await service.sendTestNotification(target, 'flag.status');
    }
    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(fcm.send).toHaveBeenCalledTimes(4);
    expect(
      (fcm.send.mock.calls as [string, PushMessage][]).map(
        ([, message]) => message.body.type,
      ),
    ).toEqual([
      'festival.reminder',
      'festival.set_reminder',
      'crew.gather',
      'flag.status',
    ]);
  });

  it('does not send when the platform token is missing', async () => {
    const missing = {
      accepted: false,
      permanent: false,
      reason: 'PUSH_TOKEN_MISSING',
    };
    await expect(
      service.sendTestNotification(
        { ...ANDROID, fcmToken: null },
        'crew.status',
      ),
    ).resolves.toEqual(missing);
    // iOS 행에 FCM 토큰이 있어도 APNs 토큰이 없으면 FCM으로 보내지 않는다.
    await expect(
      service.sendTestNotification(
        { ...IOS, apnsToken: null, fcmToken: 'x' },
        'crew.status',
      ),
    ).resolves.toEqual(missing);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(fcm.send).not.toHaveBeenCalled();
  });

  it('reports configuration per platform and overall', () => {
    apnsConfigured.mockReturnValue(true);
    fcm.isConfigured.mockReturnValue(false);
    expect(service.isConfigured()).toBe(true);
    expect(service.isConfiguredFor('ios')).toBe(true);
    expect(service.isConfiguredFor('android')).toBe(false);

    apnsConfigured.mockReturnValue(false);
    fcm.isConfigured.mockReturnValue(true);
    expect(service.isConfigured()).toBe(true);
    expect(service.isConfiguredFor('ios')).toBe(false);
    expect(service.isConfiguredFor('android')).toBe(true);

    fcm.isConfigured.mockReturnValue(false);
    expect(service.isConfigured()).toBe(false);
  });

  it('checks the token that matches the platform', () => {
    expect(hasPushTarget(IOS)).toBe(true);
    expect(hasPushTarget(ANDROID)).toBe(true);
    expect(hasPushTarget({ ...IOS, apnsEnvironment: null })).toBe(false);
    expect(hasPushTarget({ ...ANDROID, fcmToken: null })).toBe(false);
    expect(hasPushTarget({ ...IOS, apnsToken: null, fcmToken: 'x' })).toBe(
      false,
    );
    expect(hasPushTarget(null)).toBe(false);
  });
});
