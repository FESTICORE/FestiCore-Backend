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

  it('sends gather as an audible alert with route and location', async () => {
    const { session, stream } = mockResponse(200);
    const service = new ApnsService(config(credentials));
    await service.sendSocialNotification(DEVICE_TOKEN, 'sandbox', {
      type: 'crew.gather',
      eventKey: 'crew.gather:gather_123',
      payload: {
        crewId: 'crew_123',
        gatherId: 'gather_123',
        actorUserId: 'actor_123',
        nickname: '요청자',
        zoneId: 'zone_123',
      },
    });
    expect(session.request).toHaveBeenCalledWith(
      expect.objectContaining({ 'apns-priority': '10' }),
    );
    const sentArgs: unknown = stream.end.mock.calls[0];
    const payload = JSON.parse((sentArgs as [string])[0]) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      aps: { sound: 'default' },
      type: 'crew.gather',
      route: '/crews/crew_123',
      crewId: 'crew_123',
      zoneId: 'zone_123',
      actorUserId: 'actor_123',
    });
  });

  it('sends the crew dissolution message without linking to a deleted crew', async () => {
    const { stream } = mockResponse(200);
    const service = new ApnsService(config(credentials));
    await service.sendSocialNotification(DEVICE_TOKEN, 'sandbox', {
      type: 'crew.status',
      eventKey: 'crew.status:dissolved:crew_123',
      payload: { crewId: 'crew_123', dissolved: true },
    });
    const sentArgs: unknown = stream.end.mock.calls[0];
    const payload = JSON.parse((sentArgs as [string])[0]) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      aps: { alert: { title: '크루 해산', body: '크루가 해산됐어요' } },
      type: 'crew.status',
      route: '/crews',
      crewId: 'crew_123',
      dissolved: true,
    });
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

  it('sends a silent pack update with festival ID and published version', async () => {
    const { session, stream } = mockResponse(200);
    const service = new ApnsService(config(credentials));
    await expect(
      service.sendPackUpdated(DEVICE_TOKEN, 'production', 'fst_12345678', 3),
    ).resolves.toEqual({ accepted: true, permanent: false });
    const headers = (session.request.mock.calls as unknown[][])[0][0] as Record<
      string,
      string
    >;
    expect(headers['apns-push-type']).toBe('background');
    expect(headers['apns-priority']).toBe('5');
    expect(
      JSON.parse((stream.end.mock.calls as unknown[][])[0][0] as string),
    ).toMatchObject({
      aps: { 'content-available': 1 },
      type: 'pack.updated',
      festivalId: 'fst_12345678',
      packVersion: 3,
    });
  });

  it.each(['5', '10'] as const)(
    'sends a Live Activity update at priority %s with its own APNs topic',
    async (priority) => {
      const { session, stream } = mockResponse(200);
      const service = new ApnsService(config(credentials));
      const state = { festivalId: 'fst_12345678', phase: 'open' };
      const before = Math.floor(Date.now() / 1000);

      await expect(
        service.sendLiveActivityUpdate(
          DEVICE_TOKEN,
          'production',
          state,
          priority,
        ),
      ).resolves.toEqual({ accepted: true, permanent: false });

      const after = Math.floor(Date.now() / 1000);
      const headers = (
        session.request.mock.calls as unknown[][]
      )[0][0] as Record<string, string>;
      expect(headers['apns-topic']).toBe(
        `${credentials.APNS_BUNDLE_ID}.push-type.liveactivity`,
      );
      expect(headers['apns-push-type']).toBe('liveactivity');
      expect(headers['apns-priority']).toBe(priority);
      expect(headers).not.toHaveProperty('apns-collapse-id');
      expect(Number(headers['apns-expiration'])).toBeGreaterThanOrEqual(
        before + 600,
      );
      expect(Number(headers['apns-expiration'])).toBeLessThanOrEqual(
        after + 600,
      );
      const payload = JSON.parse(
        (stream.end.mock.calls as unknown[][])[0][0] as string,
      ) as { aps: Record<string, unknown> };
      expect(payload).toEqual({
        aps: {
          timestamp: payload.aps.timestamp,
          event: 'update',
          'content-state': state,
          'stale-date': payload.aps['stale-date'],
        },
      });
      const timestamp = payload.aps.timestamp as number;
      expect(typeof timestamp).toBe('number');
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
      expect(payload.aps['stale-date']).toBe(timestamp + 3600);
    },
  );

  it('sends a final Live Activity state with an end event', async () => {
    const { session, stream } = mockResponse(200);
    const service = new ApnsService(config(credentials));
    const state = { phase: 'finished', nowStages: [] };

    await expect(
      service.sendLiveActivityEnd(DEVICE_TOKEN, 'sandbox', state),
    ).resolves.toEqual({ accepted: true, permanent: false });

    const headers = (session.request.mock.calls as unknown[][])[0][0] as Record<
      string,
      string
    >;
    expect(headers['apns-topic']).toBe(
      `${credentials.APNS_BUNDLE_ID}.push-type.liveactivity`,
    );
    expect(headers['apns-push-type']).toBe('liveactivity');
    const payload = JSON.parse(
      (stream.end.mock.calls as unknown[][])[0][0] as string,
    ) as {
      aps: Record<string, unknown>;
    };
    expect(payload.aps).toEqual({
      timestamp: payload.aps.timestamp,
      event: 'end',
      'content-state': state,
    });
    expect(typeof payload.aps.timestamp).toBe('number');
  });

  it('starts a Live Activity with matching iOS attributes and requests an update token', async () => {
    const { session, stream } = mockResponse(200);
    const service = new ApnsService(config(credentials));
    const state = {
      phase: 'ongoing',
      startDate: 812345678,
      endDate: 812432078,
    };
    const before = Math.floor(Date.now() / 1000);

    await expect(
      service.sendLiveActivityStart(DEVICE_TOKEN, 'sandbox', {
        festivalId: 'fst_12345678',
        festivalName: '원더리벳',
        state,
      }),
    ).resolves.toEqual({ accepted: true, permanent: false });

    const after = Math.floor(Date.now() / 1000);
    const headers = (session.request.mock.calls as unknown[][])[0][0] as Record<
      string,
      string
    >;
    expect(headers['apns-topic']).toBe(
      `${credentials.APNS_BUNDLE_ID}.push-type.liveactivity`,
    );
    expect(headers['apns-push-type']).toBe('liveactivity');
    expect(headers['apns-priority']).toBe('10');
    expect(Number(headers['apns-expiration'])).toBeGreaterThanOrEqual(
      before + 600,
    );
    expect(Number(headers['apns-expiration'])).toBeLessThanOrEqual(after + 600);
    const payload = JSON.parse(
      (stream.end.mock.calls as unknown[][])[0][0] as string,
    ) as { aps: Record<string, unknown> };
    expect(payload.aps).toEqual({
      timestamp: payload.aps.timestamp,
      event: 'start',
      'attributes-type': 'FestiCoreFestivalActivityAttributes',
      'input-push-token': 1,
      attributes: {
        festivalID: 'fst_12345678',
        festivalName: '원더리벳',
      },
      'content-state': state,
      alert: { title: '원더리벳', body: '축제가 시작됐어요.' },
    });
    expect(payload.aps.timestamp).toBeGreaterThanOrEqual(before);
    expect(payload.aps.timestamp).toBeLessThanOrEqual(after);
  });

  it('rejects an oversized Live Activity update before connecting', async () => {
    const service = new ApnsService(config(credentials));

    await expect(
      service.sendLiveActivityUpdate(DEVICE_TOKEN, 'sandbox', {
        description: '가'.repeat(1400),
      }),
    ).resolves.toEqual({
      accepted: false,
      permanent: false,
      reason: 'PayloadTooLarge',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'routes a festival reminder based on downloaded pack state %s',
    async (hasPack) => {
      const { session, stream } = mockResponse(200);
      const service = new ApnsService(config(credentials));
      await service.sendReminderNotification(DEVICE_TOKEN, 'production', {
        festivalId: 'fst_12345678',
        title: '축제 준비물',
        body: '준비물 확인했어요?',
        eventKey: 'festival-reminder:fst_12345678',
        hasPack,
      });
      const headers = (
        session.request.mock.calls as unknown[][]
      )[0][0] as Record<string, string>;
      expect(headers['apns-push-type']).toBe('alert');
      expect(headers['apns-priority']).toBe('10');
      const payload = JSON.parse(
        (stream.end.mock.calls as unknown[][])[0][0] as string,
      ) as Record<string, unknown>;
      expect(payload).toMatchObject({
        type: 'festival.reminder',
        festivalId: 'fst_12345678',
        route: hasPack ? '/festivals/fst_12345678/checklist' : '/',
        eventKey: 'festival-reminder:fst_12345678',
        aps: {
          alert: { title: '축제 준비물', body: '준비물 확인했어요?' },
          sound: 'default',
        },
      });
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

  it.each([
    ['flag.status', 'alert', '5', false],
    ['crew.status', 'alert', '5', false],
    ['crew.gather', 'alert', '10', false],
    ['pack.updated', 'background', '5', true],
  ] as const)(
    'sends %s test push with matching APNs headers and payload',
    async (type, pushType, priority, background) => {
      const { session, stream } = mockResponse(200);
      const service = new ApnsService(config(credentials));
      await expect(
        service.sendTestNotification(DEVICE_TOKEN, 'sandbox', type),
      ).resolves.toEqual({ accepted: true, permanent: false });
      const sentHeaders: unknown = session.request.mock.calls[0];
      const headers = (sentHeaders as [Record<string, string>])[0];
      expect(headers['apns-push-type']).toBe(pushType);
      expect(headers['apns-priority']).toBe(priority);
      expect(Number(headers['apns-expiration'])).toBeGreaterThan(
        Math.floor(Date.now() / 1000),
      );
      const sentBody: unknown = stream.end.mock.calls[0];
      const payload = JSON.parse((sentBody as [string])[0]) as {
        aps: Record<string, unknown>;
        type: string;
        route: string;
      };
      expect(payload).toMatchObject({ type, route: '/' });
      expect(payload.aps['content-available'] === 1).toBe(background);
      if (background) expect(payload.aps.alert).toBeUndefined();
    },
  );
});
