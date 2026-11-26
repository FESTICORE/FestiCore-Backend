import { Injectable } from '@nestjs/common';
import {
  ApnsService,
  type ApnsSendResult,
  type PushMessage,
  type ReminderNotificationInput,
  type SetReminderNotificationInput,
  type SocialNotificationInput,
  type StartNotificationInput,
  type TestPushType,
} from './apns.service';
import { FcmService } from './fcm.service';

export type PushPlatform = 'ios' | 'android';

/** 발송 대상 기기의 푸시 토큰. `devices` 행에서 그대로 읽는다. */
export interface PushTarget {
  platform: PushPlatform;
  apnsToken: string | null;
  apnsEnvironment: 'sandbox' | 'production' | null;
  fcmToken: string | null;
}

/**
 * 발송 대상 기기 조건(SQL). `devices` 별칭은 `d`다.
 * iOS는 APNs 토큰 · 환경, Android는 FCM 토큰이 있어야 한다. `hasPushTarget`과 같은 규칙이다.
 */
export const PUSH_TARGET_SQL = `((d."platform" = 'ios' AND d."apnsToken" IS NOT NULL AND d."apnsEnvironment" IS NOT NULL)
  OR (d."platform" = 'android' AND d."fcmToken" IS NOT NULL))`;

/** 설정이 없거나 틀려 지금은 보낼 수 없는 결과. 시도 횟수를 늘리지 않고 나중에 다시 보낸다. */
export const PUSH_NOT_READY_REASONS: ReadonlySet<string> = new Set([
  'APNS_NOT_CONFIGURED',
  'APNS_CONFIGURATION_ERROR',
  'FCM_NOT_CONFIGURED',
  'FCM_CONFIGURATION_ERROR',
]);

/** 기기 platform에 맞는 토큰이 있는지. */
export function hasPushTarget<T extends PushTarget>(
  target: T | null | undefined,
): target is T {
  if (!target) return false;
  return target.platform === 'android'
    ? Boolean(target.fcmToken)
    : Boolean(target.apnsToken && target.apnsEnvironment);
}

/**
 * 기기 platform에 따라 APNs 또는 FCM으로 보낸다.
 * 페이로드는 `ApnsService.build*` 하나가 만들고, FCM은 같은 키를 data로 보낸다.
 * Live Activity는 iOS 전용이라 여기 두지 않는다.
 */
@Injectable()
export class PushService {
  constructor(
    private readonly apns: ApnsService,
    private readonly fcm: FcmService,
  ) {}

  /** APNs · FCM 중 하나라도 설정됐는지. */
  isConfigured(): boolean {
    return this.apns.isConfigured() || this.fcm.isConfigured();
  }

  isConfiguredFor(platform: PushPlatform): boolean {
    return platform === 'android'
      ? this.fcm.isConfigured()
      : this.apns.isConfigured();
  }

  sendStartNotification(
    target: PushTarget,
    input: StartNotificationInput,
  ): Promise<ApnsSendResult> {
    return this.deliver(target, this.apns.buildStartNotification(input));
  }

  sendReminderNotification(
    target: PushTarget,
    input: ReminderNotificationInput,
  ): Promise<ApnsSendResult> {
    return this.deliver(target, this.apns.buildReminderNotification(input));
  }

  sendSetReminderNotification(
    target: PushTarget,
    input: SetReminderNotificationInput,
  ): Promise<ApnsSendResult> {
    return this.deliver(target, this.apns.buildSetReminderNotification(input));
  }

  sendPackUpdated(
    target: PushTarget,
    festivalId: string,
    packVersion: number,
  ): Promise<ApnsSendResult> {
    return this.deliver(
      target,
      this.apns.buildPackUpdated(festivalId, packVersion),
    );
  }

  sendSocialNotification(
    target: PushTarget,
    input: SocialNotificationInput,
  ): Promise<ApnsSendResult> {
    return this.deliver(target, this.apns.buildSocialNotification(input));
  }

  sendTestNotification(
    target: PushTarget,
    type: TestPushType,
  ): Promise<ApnsSendResult> {
    return this.deliver(target, this.apns.buildTestNotification(type));
  }

  private async deliver(
    target: PushTarget,
    message: PushMessage,
  ): Promise<ApnsSendResult> {
    if (target.platform === 'android') {
      if (!target.fcmToken) return MISSING_TOKEN;
      return this.fcm.send(target.fcmToken, message);
    }
    if (!target.apnsToken || !target.apnsEnvironment) return MISSING_TOKEN;
    return this.apns.sendMessage(
      target.apnsToken,
      target.apnsEnvironment,
      message,
    );
  }
}

const MISSING_TOKEN: ApnsSendResult = {
  accepted: false,
  permanent: false,
  reason: 'PUSH_TOKEN_MISSING',
};
