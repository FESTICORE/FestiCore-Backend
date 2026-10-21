import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import { connect } from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';
import { ApnsService } from './apns.service';

jest.mock('node:http2', () => ({ connect: jest.fn() }));
jest.mock('jose', () => ({
  importPKCS8: jest.fn(),
  SignJWT: jest.fn(),
}));

const DEVICE_TOKEN = 'ab'.repeat(32);
const INPUT = {
  title: '축제 시작',
  body: '지금 시작합니다',
  eventKey: 'festival-1:2026-10-21',
};

function config(values: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

function mockResponse(status: number, reason?: string) {
  const stream = new EventEmitter() as EventEmitter & {
    setEncoding: jest.Mock;
    end: jest.Mock;
  };
  stream.setEncoding = jest.fn();
  stream.end = jest.fn(() => {
    queueMicrotask(() => {
      stream.emit('response', { ':status': status });
      if (reason) stream.emit('data', JSON.stringify({ reason }));
      stream.emit('end');
    });
  });
  const session = new EventEmitter() as EventEmitter & {
    request: jest.Mock;
    destroy: jest.Mock;
  };
  session.request = jest.fn(() => stream);
  session.destroy = jest.fn();
  jest.mocked(connect).mockReturnValue(session as never);
  return { session, stream };
}

describe('ApnsService', () => {
  const credentials = {
    APNS_TEAM_ID: 'TEAM123456',
    APNS_KEY_ID: 'KEY1234567',
    APNS_PRIVATE_KEY: 'line1\\nline2',
    APNS_BUNDLE_ID: 'app.festicore.ios',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(importPKCS8).mockResolvedValue({} as never);
    jest.mocked(SignJWT).mockImplementation(
      () =>
        ({
          setProtectedHeader: jest.fn().mockReturnThis(),
          setIssuer: jest.fn().mockReturnThis(),
          setIssuedAt: jest.fn().mockReturnThis(),
          sign: jest.fn().mockResolvedValue('signed-provider-token'),
        }) as never,
    );
  });

  it('posts a bounded alert request to the selected APNs environment', async () => {
    const { session, stream } = mockResponse(200);
    const service = new ApnsService(config(credentials));

    await expect(
      service.sendStartNotification(DEVICE_TOKEN, 'sandbox', INPUT),
    ).resolves.toEqual({ accepted: true, permanent: false });
    expect(connect).toHaveBeenCalledWith('https://api.sandbox.push.apple.com', {
      minVersion: 'TLSv1.2',
    });
    expect(session.request).toHaveBeenCalledWith(
      expect.objectContaining({
        ':method': 'POST',
        ':path': `/3/device/${DEVICE_TOKEN}`,
        authorization: 'bearer signed-provider-token',
        'apns-topic': credentials.APNS_BUNDLE_ID,
        'apns-push-type': 'alert',
        'apns-priority': '10',
      }),
    );
    const sentHeaders = session.request.mock.calls[0] as [
      Record<string, string>,
    ];
    expect(sentHeaders[0]['apns-collapse-id']).toMatch(/^[a-f0-9]{64}$/);
    const sentArgs: unknown = stream.end.mock.calls[0];
    const sentPayload = (sentArgs as [string])[0];
    expect(JSON.parse(sentPayload) as unknown).toEqual({
      aps: {
        alert: { title: INPUT.title, body: INPUT.body },
        sound: 'default',
      },
      eventKey: INPUT.eventKey,
    });
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(importPKCS8).toHaveBeenCalledWith('line1\nline2', 'ES256');
  });

  it('reuses its provider JWT across sends and selects the production host', async () => {
    mockResponse(200);
    const service = new ApnsService(config(credentials));
    await service.sendStartNotification(DEVICE_TOKEN, 'production', INPUT);
    await service.sendStartNotification(DEVICE_TOKEN, 'production', INPUT);

    expect(SignJWT).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith('https://api.push.apple.com', {
      minVersion: 'TLSv1.2',
    });
  });

  it.each([
    [410, 'Unregistered', true],
    [400, 'BadDeviceToken', true],
    [400, 'DeviceTokenNotForTopic', true],
    [429, 'TooManyRequests', false],
    [500, 'InternalServerError', false],
    [403, 'InvalidProviderToken', false],
  ])(
    'classifies APNs %s %s without exposing a token',
    async (status, reason, permanent) => {
      mockResponse(status, reason);
      const service = new ApnsService(config(credentials));
      await expect(
        service.sendStartNotification(DEVICE_TOKEN, 'sandbox', INPUT),
      ).resolves.toEqual({ accepted: false, permanent, reason });
    },
  );

  it('does not contact APNs for malformed tokens or missing credentials', async () => {
    const service = new ApnsService(config(credentials));
    await expect(
      service.sendStartNotification('not-a-token', 'sandbox', INPUT),
    ).resolves.toEqual({
      accepted: false,
      permanent: true,
      reason: 'BadDeviceToken',
    });
    await expect(
      new ApnsService(config()).sendStartNotification(
        DEVICE_TOKEN,
        'sandbox',
        INPUT,
      ),
    ).resolves.toEqual({
      accepted: false,
      permanent: false,
      reason: 'APNS_NOT_CONFIGURED',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('treats network errors as retryable', async () => {
    const { session } = mockResponse(200);
    session.request.mockImplementation(() => {
      throw new Error('connection failed');
    });
    const service = new ApnsService(config(credentials));
    await expect(
      service.sendStartNotification(DEVICE_TOKEN, 'sandbox', INPUT),
    ).resolves.toEqual({
      accepted: false,
      permanent: false,
      reason: 'APNS_NETWORK_ERROR',
    });
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });
});
