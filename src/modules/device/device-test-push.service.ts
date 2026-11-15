import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApnsService } from '../notification/apns.service';
import { buildDeeplink } from '../notification/deeplink';
import { buildLiveActivityContentState } from '../notification/live-activity-content';
import {
  festivalPeriod,
  publishedSets,
  publishedThumbUrl,
  records,
} from '../notification/live-activity.service';
import type { DevicePrincipal } from './device-auth.guard';
import type { DeviceTestPushDto } from './device.dto';
import { Device } from './device.entity';
import { DeviceService } from './device.service';

const RATE_LIMIT_MS = 60_000;
const DEFAULT_DELAY_SECONDS = 15;

/**
 * 개발 서버 전용 실기기 푸시 점검. 공연 알림과 Live Activity 원격 시작을 지연 발송한다.
 * 예약은 메모리에만 두므로 서버가 재시작되면 사라진다.
 */
@Injectable()
export class DeviceTestPushService {
  private readonly logger = new Logger(DeviceTestPushService.name);
  private readonly lastRequestAt = new Map<string, number>();

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly deviceService: DeviceService,
    private readonly apns: ApnsService,
    private readonly config: ConfigService,
  ) {}

  async schedule(
    deviceId: string,
    body: DeviceTestPushDto,
    principal: DevicePrincipal,
  ) {
    // 플래그를 잘못 켜도 운영 환경에서는 열지 않는다.
    if (
      this.config.get<string>('DEVICE_TEST_PUSH_ENABLED') !== 'true' ||
      this.config.get<string>('RAILWAY_ENVIRONMENT_NAME') === 'production'
    )
      throw new NotFoundException();
    await this.deviceService.ownedDevice(deviceId, principal);
    const festival = await this.deviceService.publishedFestival(
      body.festivalId,
    );
    const now = Date.now();
    for (const [id, at] of this.lastRequestAt)
      if (now - at >= RATE_LIMIT_MS) this.lastRequestAt.delete(id);
    if (this.lastRequestAt.has(deviceId))
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: '테스트 푸시는 기기별 1분에 한 번만 요청할 수 있습니다.',
        },
        429,
      );
    this.lastRequestAt.set(deviceId, now);

    const target = await this.devices.findOne({
      where: { id: deviceId },
      select: {
        id: true,
        apnsToken: true,
        liveActivityPushToStartToken: true,
        apnsEnvironment: true,
      },
    });
    const delayMs = (body.delaySeconds ?? DEFAULT_DELAY_SECONDS) * 1000;
    const published = festival.published ?? {};
    const name = typeof published.name === 'string' ? published.name : '';
    setTimeout(() => {
      void this.send(deviceId, body.festivalId, name, published, target);
    }, delayMs).unref();

    return {
      deviceId,
      festivalId: body.festivalId,
      scheduledAt: new Date(now + delayMs).toISOString(),
      alert: Boolean(target?.apnsToken),
      liveActivity: Boolean(target?.liveActivityPushToStartToken),
    };
  }

  private async send(
    deviceId: string,
    festivalId: string,
    festivalName: string,
    published: Record<string, unknown>,
    target: Device | null,
  ): Promise<void> {
    const environment = target?.apnsEnvironment;
    if (target?.apnsToken && environment) {
      try {
        const now = new Date();
        const result = await this.apns.sendSetReminderNotification(
          target.apnsToken,
          environment,
          {
            festivalId,
            title: festivalName,
            body: '테스트 공연 알림이에요.',
            eventKey: `device-test-push:${festivalId}:${now.getTime()}`,
            deeplink: buildDeeplink({ type: 'festival', festivalId }),
            expiresAt: new Date(now.getTime() + 10 * 60_000),
            festivalName,
            imageUrl: publishedThumbUrl(published),
          },
        );
        this.logger.log(
          `device test push alert deviceId=${deviceId} festivalId=${festivalId} accepted=${result.accepted} reason=${result.reason ?? 'none'}`,
        );
      } catch {
        this.logger.error(
          `device test push alert deviceId=${deviceId} festivalId=${festivalId} accepted=false reason=EXCEPTION`,
        );
      }
    }

    if (target?.liveActivityPushToStartToken && environment) {
      try {
        const period = festivalPeriod(
          records(published.days).sort((left, right) =>
            String(left.date).localeCompare(String(right.date)),
          ),
        );
        if (!period) {
          this.logger.warn(
            `device test push liveActivity deviceId=${deviceId} festivalId=${festivalId} accepted=false reason=INVALID_FESTIVAL_PERIOD`,
          );
          return;
        }
        const state = buildLiveActivityContentState({
          festivalId,
          now: new Date(),
          festivalStart: period.start,
          festivalEnd: period.end,
          sets: publishedSets(published, festivalId),
          flagsEnabled: false,
          flags: [],
          member: null,
        });
        const result = await this.apns.sendLiveActivityStart(
          target.liveActivityPushToStartToken,
          environment,
          {
            festivalId,
            festivalName,
            state: { ...state },
            alertBody: '테스트 Live Activity예요.',
          },
        );
        this.logger.log(
          `device test push liveActivity deviceId=${deviceId} festivalId=${festivalId} accepted=${result.accepted} reason=${result.reason ?? 'none'}`,
        );
      } catch {
        this.logger.error(
          `device test push liveActivity deviceId=${deviceId} festivalId=${festivalId} accepted=false reason=EXCEPTION`,
        );
      }
    }
  }
}
