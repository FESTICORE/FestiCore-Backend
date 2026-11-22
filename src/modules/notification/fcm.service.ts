import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import type { ApnsSendResult, PushMessage } from './apns.service';

const FCM_APP_NAME = 'festicore-fcm';
const MAX_DATA_BYTES = 4096;

/** 토큰을 다시 쓰면 안 되는 FCM 오류. APNs 410과 같은 의미다. */
const PERMANENT_TOKEN_CODES: Record<string, string> = {
  'messaging/registration-token-not-registered': 'FCM_UNREGISTERED',
  'messaging/invalid-registration-token': 'FCM_INVALID_TOKEN',
};
/** 서비스 계정 · Firebase 프로젝트가 맞지 않는 오류. 토큰은 지우지 않는다. */
const CONFIGURATION_CODES = new Set([
  'messaging/mismatched-credential',
  'messaging/authentication-error',
  'messaging/invalid-package-name',
]);
/** 페이로드가 잘못된 서버 버그. 토큰은 유지하고 제한된 재시도 뒤 실패한다. */
const INVALID_MESSAGE_CODES = new Set([
  'messaging/invalid-argument',
  'messaging/invalid-payload',
  'messaging/invalid-data-payload-key',
  'messaging/invalid-options',
  'messaging/invalid-recipient',
  'messaging/payload-size-limit-exceeded',
]);
const QUOTA_CODES = new Set([
  'messaging/message-rate-exceeded',
  'messaging/device-message-rate-exceeded',
]);

/** `FCM_SERVICE_ACCOUNT_JSON`(서비스 계정 JSON 한 줄)을 읽는다. 형식이 틀리면 null. */
function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const projectId = json.project_id;
    const clientEmail = json.client_email;
    const privateKey = json.private_key;
    if (
      typeof projectId !== 'string' ||
      typeof clientEmail !== 'string' ||
      typeof privateKey !== 'string' ||
      !projectId ||
      !clientEmail ||
      !privateKey
    ) {
      return null;
    }
    return { projectId, clientEmail, privateKey };
  } catch {
    return null;
  }
}

/** APNs 본문(aps 밖 키)을 FCM data로 바꾼다. 값은 문자열, null은 뺀다. */
export function toFcmData(
  body: Record<string, unknown>,
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'aps' || value === null || value === undefined) continue;
    data[key] =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
  }
  const aps = body.aps as
    { alert?: { title?: unknown; body?: unknown } } | undefined;
  if (typeof aps?.alert?.title === 'string') data.title = aps.alert.title;
  if (typeof aps?.alert?.body === 'string') data.body = aps.alert.body;
  return data;
}

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private readonly serviceAccount: ServiceAccount | null;
  private app?: App;

  constructor(config: ConfigService) {
    const raw = config.get<string>('FCM_SERVICE_ACCOUNT_JSON');
    this.serviceAccount = parseServiceAccount(raw);
    // 비밀 값은 로그에 넣지 않는다. 설정 여부만 남긴다.
    if (!this.serviceAccount) {
      this.logger.warn(
        raw?.trim()
          ? 'FCM_SERVICE_ACCOUNT_JSON 형식이 올바르지 않아 Android 푸시를 보내지 않습니다.'
          : 'FCM_SERVICE_ACCOUNT_JSON이 없어 Android 푸시를 보내지 않습니다.',
      );
    }
  }

  isConfigured(): boolean {
    return this.serviceAccount !== null;
  }

  /** `ApnsService.build*`가 만든 메시지를 data 전용 FCM 메시지로 보낸다. */
  async send(fcmToken: string, message: PushMessage): Promise<ApnsSendResult> {
    if (!this.serviceAccount) {
      return {
        accepted: false,
        permanent: false,
        reason: 'FCM_NOT_CONFIGURED',
      };
    }

    const fcmMessage = this.toMessage(fcmToken, message);
    if (
      Buffer.byteLength(JSON.stringify(fcmMessage.data), 'utf8') >
      MAX_DATA_BYTES
    ) {
      return { accepted: false, permanent: false, reason: 'PayloadTooLarge' };
    }

    let app: App;
    try {
      app = this.getApp(this.serviceAccount);
    } catch {
      return {
        accepted: false,
        permanent: false,
        reason: 'FCM_CONFIGURATION_ERROR',
      };
    }

    try {
      await getMessaging(app).send(fcmMessage);
      return { accepted: true, permanent: false };
    } catch (error) {
      return this.classify(error);
    }
  }

  toMessage(
    fcmToken: string,
    message: PushMessage,
  ): Message & { token: string } {
    const { options } = message;
    const background = options.pushType === 'background';
    return {
      token: fcmToken,
      // notification 키를 넣지 않는다. 앱이 백그라운드여도 onMessageReceived가 불린다.
      data: toFcmData(message.body),
      android: {
        priority: background ? 'normal' : 'high',
        ...(options.expirationSeconds
          ? { ttl: options.expirationSeconds * 1000 }
          : {}),
        ...(background && options.collapseKey
          ? { collapseKey: options.collapseKey }
          : {}),
      },
    };
  }

  private getApp(serviceAccount: ServiceAccount): App {
    if (this.app) return this.app;
    this.app =
      getApps().find((app) => app.name === FCM_APP_NAME) ??
      initializeApp({ credential: cert(serviceAccount) }, FCM_APP_NAME);
    return this.app;
  }

  private classify(error: unknown): ApnsSendResult {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code !== 'string') {
      return { accepted: false, permanent: false, reason: 'FCM_NETWORK_ERROR' };
    }
    const permanentReason = PERMANENT_TOKEN_CODES[code];
    if (permanentReason) {
      return { accepted: false, permanent: true, reason: permanentReason };
    }
    if (CONFIGURATION_CODES.has(code)) {
      this.logger.warn(
        `FCM 설정 오류(${code}): 서비스 계정과 Android 앱의 Firebase 프로젝트를 확인하세요.`,
      );
      return {
        accepted: false,
        permanent: false,
        reason: 'FCM_CONFIGURATION_ERROR',
      };
    }
    if (INVALID_MESSAGE_CODES.has(code)) {
      return {
        accepted: false,
        permanent: false,
        reason: 'FCM_INVALID_ARGUMENT',
      };
    }
    if (QUOTA_CODES.has(code)) {
      return {
        accepted: false,
        permanent: false,
        reason: 'FCM_QUOTA_EXCEEDED',
      };
    }
    if (code === 'messaging/server-unavailable') {
      return { accepted: false, permanent: false, reason: 'FCM_HTTP_503' };
    }
    if (code === 'messaging/internal-error') {
      return { accepted: false, permanent: false, reason: 'FCM_HTTP_500' };
    }
    return { accepted: false, permanent: false, reason: 'FCM_UNKNOWN_ERROR' };
  }
}
