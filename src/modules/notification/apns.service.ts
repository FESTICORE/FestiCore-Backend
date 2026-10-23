import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  connect,
  type ClientHttp2Session,
  type ClientHttp2Stream,
} from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';

export interface ApnsSendResult {
  accepted: boolean;
  /** True only when the device token must not be used again. */
  permanent: boolean;
  reason?: string;
}

export type TestPushType =
  'flag.status' | 'crew.status' | 'crew.gather' | 'pack.updated';

const REQUEST_TIMEOUT_MS = 8_000;
const PROVIDER_TOKEN_LIFETIME_MS = 40 * 60_000;
const PERMANENT_TOKEN_REASONS = new Set([
  'BadDeviceToken',
  'DeviceTokenNotForTopic',
  'ExpiredToken',
  'Unregistered',
]);

@Injectable()
export class ApnsService {
  private providerToken?: { value: string; createdAt: number };
  private providerTokenPromise?: Promise<string>;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('APNS_BUNDLE_ID') &&
      this.config.get<string>('APNS_TEAM_ID') &&
      this.config.get<string>('APNS_KEY_ID') &&
      this.config.get<string>('APNS_PRIVATE_KEY'),
    );
  }

  async sendStartNotification(
    token: string,
    environment: 'sandbox' | 'production',
    input: { title: string; body: string; eventKey: string },
  ): Promise<ApnsSendResult> {
    return this.send(
      token,
      environment,
      {
        aps: {
          alert: { title: input.title, body: input.body },
          sound: 'default',
        },
        eventKey: input.eventKey,
      },
      { pushType: 'alert', priority: '10', collapseKey: input.eventKey },
    );
  }

  async sendReminderNotification(
    token: string,
    environment: 'sandbox' | 'production',
    input: {
      festivalId: string;
      title: string;
      body: string;
      eventKey: string;
      hasPack: boolean;
    },
  ): Promise<ApnsSendResult> {
    return this.send(
      token,
      environment,
      {
        aps: {
          alert: { title: input.title, body: input.body },
          sound: 'default',
        },
        type: 'festival.reminder',
        route: input.hasPack ? `/festivals/${input.festivalId}/checklist` : '/',
        festivalId: input.festivalId,
        eventKey: input.eventKey,
      },
      { pushType: 'alert', priority: '10', collapseKey: input.eventKey },
    );
  }

  async sendPackUpdated(
    token: string,
    environment: 'sandbox' | 'production',
    festivalId: string,
    packVersion: number,
  ): Promise<ApnsSendResult> {
    return this.send(
      token,
      environment,
      {
        aps: { 'content-available': 1 },
        type: 'pack.updated',
        festivalId,
        packVersion,
      },
      {
        pushType: 'background',
        priority: '5',
        collapseKey: `pack:${festivalId}`,
        expirationSeconds: 24 * 60 * 60,
      },
    );
  }

  async sendSocialNotification(
    token: string,
    environment: 'sandbox' | 'production',
    input: {
      type: 'flag.status' | 'crew.status' | 'crew.gather';
      payload: Record<string, unknown>;
      eventKey: string;
    },
  ): Promise<ApnsSendResult> {
    const gather = input.type === 'crew.gather';
    const flag = input.type === 'flag.status';
    const name =
      typeof input.payload.nickname === 'string'
        ? input.payload.nickname
        : '크루원';
    const zone =
      typeof input.payload.zoneId === 'string' ? input.payload.zoneId : null;
    const rawState = flag ? input.payload.status : input.payload.state;
    const state = typeof rawState === 'string' ? rawState : '';
    const title = gather
      ? '크루 집결 요청'
      : flag
        ? '깃발 상태 변경'
        : '크루원 상태 변경';
    const body = gather
      ? `${name}님이 ${zone ?? '현재 위치'}에서 집결을 요청했어요.`
      : flag
        ? `깃발 상태가 ${state}(으)로 변경됐어요.`
        : `${name}님의 상태가 ${state}(으)로 변경됐어요.`;
    const subjectId = flag ? input.payload.flagId : input.payload.crewId;
    const safeSubjectId = typeof subjectId === 'string' ? subjectId : '';
    const route = flag ? `/flags/${safeSubjectId}` : `/crews/${safeSubjectId}`;
    return this.send(
      token,
      environment,
      {
        aps: {
          alert: { title, body },
          ...(gather
            ? { sound: 'default' }
            : { 'interruption-level': 'passive' }),
        },
        type: input.type,
        route,
        ...input.payload,
        eventKey: input.eventKey,
      },
      {
        pushType: 'alert',
        priority: gather ? '10' : '5',
        collapseKey: input.eventKey,
        expirationSeconds: gather ? 15 * 60 : 30 * 60,
      },
    );
  }

  async sendTestNotification(
    token: string,
    environment: 'sandbox' | 'production',
    type: TestPushType,
  ): Promise<ApnsSendResult> {
    const background = type === 'pack.updated';
    const gather = type === 'crew.gather';
    const payload = background
      ? { aps: { 'content-available': 1 }, type, route: '/' }
      : {
          aps: {
            alert: {
              title: 'FestiCore 테스트 알림',
              body: `${type} 테스트 푸시입니다.`,
            },
            ...(gather
              ? { sound: 'default' }
              : { 'interruption-level': 'passive' }),
          },
          type,
          route: '/',
        };
    return this.send(token, environment, payload, {
      pushType: background ? 'background' : 'alert',
      priority: gather ? '10' : '5',
      collapseKey: `test:${type}`,
      expirationSeconds: background ? 24 * 60 * 60 : gather ? 15 * 60 : 30 * 60,
    });
  }

  private async send(
    token: string,
    environment: 'sandbox' | 'production',
    body: object,
    options: {
      pushType: 'alert' | 'background';
      priority: '5' | '10';
      collapseKey: string;
      expirationSeconds?: number;
    },
  ): Promise<ApnsSendResult> {
    if (!/^[a-f\d]{2,512}$/i.test(token) || token.length % 2 !== 0) {
      return { accepted: false, permanent: true, reason: 'BadDeviceToken' };
    }

    const bundleId = this.config.get<string>('APNS_BUNDLE_ID');
    if (!bundleId) {
      return {
        accepted: false,
        permanent: false,
        reason: 'APNS_NOT_CONFIGURED',
      };
    }

    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload, 'utf8') > 4096) {
      return { accepted: false, permanent: false, reason: 'PayloadTooLarge' };
    }

    let authorization: string;
    try {
      authorization = await this.getProviderToken();
    } catch {
      return {
        accepted: false,
        permanent: false,
        reason: 'APNS_CONFIGURATION_ERROR',
      };
    }

    const host =
      environment === 'sandbox'
        ? 'https://api.sandbox.push.apple.com'
        : 'https://api.push.apple.com';
    const collapseId = createHash('sha256')
      .update(options.collapseKey)
      .digest('hex');

    try {
      return await this.post(
        host,
        {
          ':method': 'POST',
          ':path': `/3/device/${token}`,
          authorization: `bearer ${authorization}`,
          'apns-topic': bundleId,
          'apns-push-type': options.pushType,
          'apns-priority': options.priority,
          'apns-collapse-id': collapseId,
          ...(options.expirationSeconds
            ? {
                'apns-expiration': String(
                  Math.floor(Date.now() / 1000) + options.expirationSeconds,
                ),
              }
            : {}),
          'content-type': 'application/json',
        },
        payload,
      );
    } catch {
      return {
        accepted: false,
        permanent: false,
        reason: 'APNS_NETWORK_ERROR',
      };
    }
  }

  private async getProviderToken(): Promise<string> {
    const now = Date.now();
    if (
      this.providerToken &&
      now - this.providerToken.createdAt < PROVIDER_TOKEN_LIFETIME_MS
    ) {
      return this.providerToken.value;
    }
    if (this.providerTokenPromise) return this.providerTokenPromise;

    this.providerTokenPromise = this.signProviderToken(now).finally(() => {
      this.providerTokenPromise = undefined;
    });
    return this.providerTokenPromise;
  }

  private async signProviderToken(createdAt: number): Promise<string> {
    const teamId = this.config.get<string>('APNS_TEAM_ID');
    const keyId = this.config.get<string>('APNS_KEY_ID');
    const privateKey = this.config.get<string>('APNS_PRIVATE_KEY');
    if (!teamId || !keyId || !privateKey)
      throw new Error('APNs credentials missing');

    const key = await importPKCS8(privateKey.replace(/\\n/g, '\n'), 'ES256');
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt(Math.floor(createdAt / 1000))
      .sign(key);
    this.providerToken = { value, createdAt };
    return value;
  }

  private post(
    host: string,
    headers: Record<string, string>,
    payload: string,
  ): Promise<ApnsSendResult> {
    return new Promise((resolve, reject) => {
      let session: ClientHttp2Session;
      try {
        session = connect(host, { minVersion: 'TLSv1.2' });
      } catch (error) {
        reject(error as Error);
        return;
      }

      let finished = false;
      const finish = (result?: ApnsSendResult, error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        session.destroy();
        if (error) reject(error);
        else resolve(result!);
      };
      const timeout = setTimeout(() => {
        finish(undefined, new Error('APNs request timed out'));
      }, REQUEST_TIMEOUT_MS);

      session.on('error', (error: Error) => finish(undefined, error));
      let stream: ClientHttp2Stream;
      try {
        stream = session.request(headers);
      } catch (error) {
        finish(undefined, error as Error);
        return;
      }
      let status = 0;
      let responseBody = '';
      stream.setEncoding('utf8');
      stream.on('response', (responseHeaders) => {
        status = Number(responseHeaders[':status'] ?? 0);
      });
      stream.on('data', (chunk: string) => {
        if (responseBody.length < 1024) responseBody += chunk.slice(0, 1024);
      });
      stream.on('error', (error: Error) => finish(undefined, error));
      stream.on('end', () => {
        if (status === 200) {
          finish({ accepted: true, permanent: false });
          return;
        }
        let reason: string | undefined;
        try {
          const parsed = JSON.parse(responseBody) as { reason?: unknown };
          if (
            typeof parsed.reason === 'string' &&
            /^[A-Za-z][A-Za-z\d]{0,63}$/.test(parsed.reason)
          ) {
            reason = parsed.reason;
          }
        } catch {
          // Invalid APNs responses remain retryable, without echoing their body.
        }
        finish({
          accepted: false,
          permanent:
            status === 410 ||
            (status === 400 && !!reason && PERMANENT_TOKEN_REASONS.has(reason)),
          reason: reason ?? `APNS_HTTP_${status || 'UNKNOWN'}`,
        });
      });
      stream.end(payload);
    });
  }
}
