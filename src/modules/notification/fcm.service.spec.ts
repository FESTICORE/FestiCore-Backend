import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { ApnsService } from './apns.service';
import { FcmService } from './fcm.service';

// 실제 Firebase를 부르지 않는다.
jest.mock('firebase-admin/app', () => ({
  cert: jest.fn(() => ({ kind: 'credential' })),
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(() => ({ name: 'festicore-fcm' })),
}));
jest.mock('firebase-admin/messaging', () => ({ getMessaging: jest.fn() }));

const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'festicore-stage',
  client_email: 'push@festicore-stage.iam.gserviceaccount.com',
  private_key: 'fake-private-key',
});
const TOKEN = 'fcm-registration-token';

function config(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

type SentMessage = {
  token: string;
  data: Record<string, string>;
  android: Record<string, unknown>;
};

describe('FcmService', () => {
  const send = jest.fn();
  const sent = (index: number) =>
    (send.mock.calls as [SentMessage][])[index][0];
  const apns = new ApnsService(config());

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getMessaging).mockReturnValue({ send } as never);
    send.mockResolvedValue('projects/festicore-stage/messages/1');
  });

  function configured() {
    return new FcmService(
      config({ FCM_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT }),
    );
  }

  it('is off without a valid service account and never calls Firebase', async () => {
    for (const raw of [undefined, '', 'not-json', '{"project_id":"x"}']) {
      const service = new FcmService(
        config(raw === undefined ? {} : { FCM_SERVICE_ACCOUNT_JSON: raw }),
      );
      expect(service.isConfigured()).toBe(false);
      await expect(
        service.send(TOKEN, apns.buildTestNotification('crew.status')),
      ).resolves.toEqual({
        accepted: false,
        permanent: false,
        reason: 'FCM_NOT_CONFIGURED',
      });
    }
    expect(initializeApp).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not log the service account value', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    new FcmService(
      config({ FCM_SERVICE_ACCOUNT_JSON: '{"private_key":"leak-me-key"' }),
    );
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('leak-me-key');
    warn.mockRestore();
  });

  it('initializes a named app once from the service account', async () => {
    const service = configured();
    expect(service.isConfigured()).toBe(true);
    const message = apns.buildTestNotification('crew.status');
    await expect(service.send(TOKEN, message)).resolves.toEqual({
      accepted: true,
      permanent: false,
    });
    await service.send(TOKEN, message);
    expect(cert).toHaveBeenCalledWith({
      projectId: 'festicore-stage',
      clientEmail: 'push@festicore-stage.iam.gserviceaccount.com',
      privateKey: 'fake-private-key',
    });
    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(initializeApp).toHaveBeenCalledWith(
      { credential: { kind: 'credential' } },
      'festicore-fcm',
    );
  });

  it('reuses an app that is already registered under the same name', async () => {
    jest
      .mocked(getApps)
      .mockReturnValueOnce([{ name: 'festicore-fcm' }] as never);
    await configured().send(TOKEN, apns.buildTestNotification('flag.status'));
    expect(initializeApp).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends a data-only message whose keys match the iOS userInfo plus title and body', async () => {
    const message = apns.buildStartNotification({
      title: '축제 시작',
      body: '지금 시작합니다',
      eventKey: 'festival-start:f1:2026-10-21',
      type: 'festival.start',
      festivalId: 'f1',
      festivalName: '페스티벌',
      imageUrl: 'https://cdn.example.com/thumb.png',
    });
    await configured().send(TOKEN, message);

    const message0 = sent(0);
    expect(message0).not.toHaveProperty('notification');
    expect(message0.token).toBe(TOKEN);
    const userInfoKeys = Object.keys(message.body).filter((k) => k !== 'aps');
    expect(Object.keys(message0.data).sort()).toEqual(
      [...userInfoKeys, 'title', 'body'].sort(),
    );
    expect(message0.data).toEqual({
      type: 'festival.start',
      festivalId: 'f1',
      festivalName: '페스티벌',
      imageUrl: 'https://cdn.example.com/thumb.png',
      eventKey: 'festival-start:f1:2026-10-21',
      title: '축제 시작',
      body: '지금 시작합니다',
    });
    expect(message0.android).toEqual({ priority: 'high' });
  });

  it('stringifies numbers and booleans and omits null values', async () => {
    const service = configured();
    await service.send(TOKEN, apns.buildPackUpdated('f1', 3));
    await service.send(
      TOKEN,
      apns.buildSocialNotification({
        type: 'crew.status',
        payload: {
          crewId: 'c1',
          nickname: '로이',
          state: 'left',
          dissolved: true,
          zoneId: null,
        },
        eventKey: 'crew-status:c1:1',
      }),
    );

    const pack = sent(0);
    expect(pack.data).toEqual({
      type: 'pack.updated',
      festivalId: 'f1',
      packVersion: '3',
    });
    const social = sent(1);
    expect(social.data.dissolved).toBe('true');
    expect(social.data).not.toHaveProperty('zoneId');
    for (const value of Object.values(social.data)) {
      expect(typeof value).toBe('string');
    }
  });

  it('uses normal priority and a collapse key only for silent pushes', async () => {
    const service = configured();
    await service.send(TOKEN, apns.buildPackUpdated('f1', 3));
    await service.send(
      TOKEN,
      apns.buildSocialNotification({
        type: 'flag.status',
        payload: { flagId: 'flag-1', status: 'open' },
        eventKey: 'flag-status:flag-1:1',
      }),
    );

    const pack = sent(0);
    expect(pack.data).not.toHaveProperty('title');
    expect(pack.data).not.toHaveProperty('body');
    expect(pack.android).toEqual({
      priority: 'normal',
      ttl: 24 * 60 * 60 * 1000,
      collapseKey: 'pack:f1',
    });
    // iOS priority 5인 소셜 알림도 Android에서는 보이는 알림이라 high다.
    const social = sent(1);
    expect(social.android).toEqual({ priority: 'high', ttl: 30 * 60 * 1000 });
  });

  it('refuses a data payload over 4096 bytes without sending', async () => {
    await expect(
      configured().send(TOKEN, {
        body: { aps: {}, type: 'flag.status', blob: 'x'.repeat(5000) },
        options: { pushType: 'alert', priority: '10' },
      }),
    ).resolves.toEqual({
      accepted: false,
      permanent: false,
      reason: 'PayloadTooLarge',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['messaging/registration-token-not-registered', true, 'FCM_UNREGISTERED'],
    ['messaging/invalid-registration-token', true, 'FCM_INVALID_TOKEN'],
    ['messaging/mismatched-credential', false, 'FCM_CONFIGURATION_ERROR'],
    ['messaging/authentication-error', false, 'FCM_CONFIGURATION_ERROR'],
    ['messaging/invalid-argument', false, 'FCM_INVALID_ARGUMENT'],
    ['messaging/message-rate-exceeded', false, 'FCM_QUOTA_EXCEEDED'],
    ['messaging/server-unavailable', false, 'FCM_HTTP_503'],
    ['messaging/internal-error', false, 'FCM_HTTP_500'],
    ['messaging/unknown-error', false, 'FCM_UNKNOWN_ERROR'],
  ])('classifies %s', async (code, permanent, reason) => {
    send.mockRejectedValueOnce(Object.assign(new Error('fcm'), { code }));
    await expect(
      configured().send(TOKEN, apns.buildTestNotification('crew.gather')),
    ).resolves.toEqual({ accepted: false, permanent, reason });
  });

  it('treats errors without a Firebase code as retryable network errors', async () => {
    send.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(
      configured().send(TOKEN, apns.buildTestNotification('crew.gather')),
    ).resolves.toEqual({
      accepted: false,
      permanent: false,
      reason: 'FCM_NETWORK_ERROR',
    });
  });

  it('reports a credential the SDK rejects as a configuration error', async () => {
    jest.mocked(cert).mockImplementationOnce(() => {
      throw new Error('invalid key');
    });
    await expect(
      configured().send(TOKEN, apns.buildTestNotification('crew.gather')),
    ).resolves.toEqual({
      accepted: false,
      permanent: false,
      reason: 'FCM_CONFIGURATION_ERROR',
    });
    expect(send).not.toHaveBeenCalled();
  });
});
