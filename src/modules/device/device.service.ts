import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { Device, DeviceSubscription } from './device.entity';
import type { DevicePrincipal } from './device-auth.guard';
import {
  DeviceSubscriptionDto,
  LiveActivityDto,
  RegisterDeviceDto,
  PackDownloadDto,
} from './device.dto';

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);
  private lastRateLimitCleanupMinute = Math.floor(Date.now() / 60_000);

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(DeviceSubscription)
    private readonly subscriptions: Repository<DeviceSubscription>,
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async register(
    id: string,
    body: RegisterDeviceDto,
    principal: DevicePrincipal,
  ) {
    this.requireId(id);
    try {
      new Intl.DateTimeFormat('en', { timeZone: body.timezone });
    } catch {
      throw new BadRequestException('지원하지 않는 timezone입니다.');
    }
    const values = {
      ...(body.apnsToken !== undefined ? { apnsToken: body.apnsToken } : {}),
      ...(body.liveActivityPushToStartToken !== undefined
        ? { liveActivityPushToStartToken: body.liveActivityPushToStartToken }
        : {}),
      appVersion: body.appVersion,
      osVersion: body.osVersion,
      locale: body.locale,
      timezone: body.timezone,
      apnsEnvironment: body.apnsEnvironment,
    };
    const device = await this.devices.findOne({ where: { id } });
    const userId = principal.kind === 'user' ? principal.userId : null;
    let deviceTokenId: string | null = null;
    if (!device) {
      deviceTokenId = principal.kind === 'anonymous' ? randomUUID() : null;
      try {
        await this.devices.insert({
          id,
          userId,
          deviceTokenId,
          apnsToken: body.apnsToken ?? null,
          liveActivityPushToStartToken:
            body.liveActivityPushToStartToken ?? null,
          ...values,
        });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new ForbiddenException('이미 등록된 기기입니다.');
        }
        throw error;
      }
    } else {
      if (principal.kind === 'anonymous')
        throw new ForbiddenException('이미 등록된 기기입니다.');
      await this.ownedDevice(id, principal);
      deviceTokenId = principal.kind === 'device' ? randomUUID() : null;
      const update = await this.devices.update(
        this.ownerCondition(id, principal),
        {
          ...values,
          ...(deviceTokenId ? { deviceTokenId } : {}),
        },
      );
      if (update.affected !== 1) {
        throw new ForbiddenException('기기 소유권을 확인할 수 없습니다.');
      }
    }
    const subscriptions = await this.subscriptions.find({
      where: { deviceId: id },
    });
    const deviceAccessToken = deviceTokenId
      ? await this.jwt.signAsync(
          { typ: 'device', sub: id, jti: deviceTokenId },
          {
            secret: this.config.get<string>('auth.jwt.accessSecret'),
            expiresIn: '365d',
          },
        )
      : undefined;
    return {
      deviceId: id,
      userId,
      ...(deviceAccessToken ? { deviceAccessToken } : {}),
      subscriptions: subscriptions.map(
        ({
          festivalId,
          packUpdates,
          festivalStarts,
          pinned,
          reminders,
          pinnedAt,
        }) => ({
          festivalId,
          packUpdates,
          festivalStarts,
          pinned,
          reminders,
          pinnedAt,
        }),
      ),
    };
  }

  async get(id: string, principal: DevicePrincipal) {
    const device = await this.ownedDevice(id, principal);
    return {
      deviceId: device.id,
      userId: device.userId,
      appVersion: device.appVersion,
      osVersion: device.osVersion,
      locale: device.locale,
      timezone: device.timezone,
      apnsEnvironment: device.apnsEnvironment,
    };
  }

  async remove(id: string, principal: DevicePrincipal) {
    await this.ownedDevice(id, principal);
    const result = await this.devices.delete(
      this.ownerCondition(id, principal),
    );
    if (result.affected !== 1)
      throw new ForbiddenException('기기 소유권을 확인할 수 없습니다.');
  }

  async startLiveActivity(
    id: string,
    body: LiveActivityDto,
    principal: DevicePrincipal,
  ) {
    await this.ownedDevice(id, principal);
    await this.publishedFestival(body.festivalId);
    const result = await this.devices.update(
      this.ownerCondition(id, principal),
      {
        liveActivityFestivalId: body.festivalId,
        liveActivityId: body.activityId,
        liveActivityPushToken: body.pushToken,
      },
    );
    if (result.affected !== 1)
      throw new ForbiddenException('기기 소유권을 확인할 수 없습니다.');
  }

  async stopLiveActivity(id: string, principal: DevicePrincipal) {
    await this.ownedDevice(id, principal);
    const result = await this.devices.update(
      this.ownerCondition(id, principal),
      {
        liveActivityFestivalId: null,
        liveActivityId: null,
        liveActivityPushToken: null,
      },
    );
    if (result.affected !== 1)
      throw new ForbiddenException('기기 소유권을 확인할 수 없습니다.');
  }

  async subscribe(
    id: string,
    festivalId: string,
    body: DeviceSubscriptionDto,
    principal: DevicePrincipal,
  ) {
    await this.ownedDevice(id, principal);
    await this.publishedFestival(festivalId);
    await this.limitSubscriptionWrites(id);
    const previous = await this.subscriptions.findOne({
      where: { deviceId: id, festivalId },
    });
    const pinned = body.pinned;
    const pinnedAt = pinned
      ? previous?.pinned
        ? previous.pinnedAt
        : new Date()
      : null;
    const reminders = body.reminders ?? true;
    const packUpdates = body.packUpdates ?? false;
    const festivalStarts =
      body.festivalStarts ?? previous?.festivalStarts ?? false;
    await this.subscriptions.save({
      deviceId: id,
      festivalId,
      pinned,
      pinnedAt,
      reminders,
      packUpdates,
      festivalStarts,
      packDownloadedVersion: previous?.packDownloadedVersion ?? null,
    });
    return {
      festivalId,
      pinned,
      pinnedAt,
      reminders,
      packUpdates,
      festivalStarts,
    };
  }

  async listSubscriptions(id: string, principal: DevicePrincipal) {
    await this.ownedDevice(id, principal);
    const subscriptions = await this.subscriptions.find({
      where: { deviceId: id },
    });
    return {
      items: subscriptions.map(
        ({
          festivalId,
          packUpdates,
          festivalStarts,
          pinned,
          reminders,
          pinnedAt,
        }) => ({
          festivalId,
          packUpdates,
          festivalStarts,
          pinned,
          reminders,
          pinnedAt,
        }),
      ),
    };
  }

  async unsubscribe(
    id: string,
    festivalId: string,
    principal: DevicePrincipal,
  ) {
    await this.ownedDevice(id, principal);
    await this.subscriptions.delete({ deviceId: id, festivalId });
  }

  async acknowledgePackDownload(
    id: string,
    festivalId: string,
    body: PackDownloadDto,
    principal: DevicePrincipal,
  ) {
    await this.ownedDevice(id, principal);
    const subscription = await this.subscriptions.findOne({
      where: { deviceId: id, festivalId },
    });
    if (!subscription) throw new NotFoundException('구독을 찾을 수 없습니다.');
    const festival = await this.publishedFestival(festivalId);
    if (body.packVersion !== festival.publishedVersion)
      throw new BadRequestException('현재 발행된 팩 버전과 일치하지 않습니다.');
    await this.subscriptions.update(
      { deviceId: id, festivalId },
      { packDownloadedVersion: body.packVersion },
    );
  }

  private requireId(id: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new BadRequestException('deviceId는 UUID v4여야 합니다.');
  }

  private async limitSubscriptionWrites(id: string): Promise<void> {
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const rows = await this.dataSource.query<{ count: number }[]>(
      `INSERT INTO device_subscription_rate_limits ("deviceId", minute, count)
       VALUES ($1, $2, 1)
       ON CONFLICT ("deviceId", minute) DO UPDATE
       SET count = device_subscription_rate_limits.count + 1
       WHERE device_subscription_rate_limits.count < 10
       RETURNING count`,
      [id, minute],
    );
    if (rows.length === 0) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: '기기별 구독 변경 횟수를 초과했습니다.',
        },
        429,
      );
    }
    if (minute - this.lastRateLimitCleanupMinute >= 60) {
      this.lastRateLimitCleanupMinute = minute;
      try {
        await this.dataSource.query(
          'DELETE FROM device_subscription_rate_limits WHERE minute < $1',
          [minute - 1_440],
        );
      } catch (error) {
        this.logger.warn(
          `지난 기기 구독 제한 기록 정리에 실패했습니다: ${String(error)}`,
        );
      }
    }
  }

  private ownerCondition(id: string, principal: DevicePrincipal) {
    if (principal.kind === 'user') return { id, userId: principal.userId };
    if (principal.kind === 'device')
      return { id, deviceTokenId: principal.tokenId };
    throw new ForbiddenException('기기 인증이 필요합니다.');
  }

  private async ownedDevice(
    id: string,
    principal: DevicePrincipal,
  ): Promise<Device> {
    this.requireId(id);
    const device = await this.devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('등록되지 않은 기기입니다.');
    if (
      principal.kind === 'anonymous' ||
      (principal.kind === 'user' && device.userId !== principal.userId) ||
      (principal.kind === 'device' &&
        (device.id !== principal.deviceId ||
          device.deviceTokenId !== principal.tokenId))
    )
      throw new ForbiddenException('기기 소유자가 다릅니다.');
    return device;
  }

  private async publishedFestival(id: string) {
    if (!/^fst_[0-9a-z]+$/.test(id))
      throw new BadRequestException('festivalId 형식이 올바르지 않습니다.');
    const festival = await this.festivals.findOne({ where: { id } });
    if (!festival?.published || festival.publishedVersion < 1)
      throw new NotFoundException({
        code: 'FESTIVAL_NOT_FOUND',
        message: '공개된 페스티벌을 찾을 수 없습니다.',
      });
    return festival;
  }
}
