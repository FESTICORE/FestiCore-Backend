import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { User } from '../auth/entity/user.entity';
import { Device, DeviceSubscription } from './device.entity';
import {
  DeviceSubscriptionDto,
  LiveActivityDto,
  RegisterDeviceDto,
} from './device.dto';

@Injectable()
export class DeviceService {
  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(DeviceSubscription)
    private readonly subscriptions: Repository<DeviceSubscription>,
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async optionalUser(
    authorization: string | undefined,
  ): Promise<string | null> {
    if (!authorization) return null;
    const match = /^Bearer (\S+)$/.exec(authorization);
    if (!match)
      throw new UnauthorizedException('인증 토큰 형식이 올바르지 않습니다.');
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        typ: string;
        provider: string;
      }>(match[1], {
        secret: this.config.get<string>('auth.jwt.accessSecret'),
      });
      if (
        payload.typ !== 'access' ||
        !/^[0-9a-f-]{36}$/i.test(payload.sub) ||
        (payload.provider !== 'google' && payload.provider !== 'apple')
      )
        throw new Error();
      const account = await this.users.findOne({
        where: { id: payload.sub },
        select: { id: true, provider: true },
      });
      if (!account || account.provider !== payload.provider) throw new Error();
      return account.id;
    } catch {
      throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
    }
  }

  async register(
    id: string,
    body: RegisterDeviceDto,
    userId: string | null,
    secret?: string,
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
    let issuedSecret: string | undefined;
    if (!device) {
      issuedSecret = randomBytes(32).toString('hex');
      try {
        await this.devices.insert({
          id,
          userId,
          deviceSecretHash: this.hashSecret(issuedSecret),
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
      // 기기 UUID만 아는 다른 계정이 APNs 토큰을 바꾸거나 소유권을 빼앗지 못하게
      // 기존 기기의 모든 재등록에 최초 발급한 비밀값을 요구한다.
      const where = this.ownershipWhere(id, device.userId, secret);
      const update = await this.devices.update(where, {
        ...values,
        userId: userId ?? device.userId,
      });
      if (update.affected !== 1) {
        throw new ForbiddenException('기기 소유권을 확인할 수 없습니다.');
      }
    }
    const subscriptions = await this.subscriptions.find({
      where: { deviceId: id },
    });
    return {
      deviceId: id,
      userId: userId ?? device?.userId ?? null,
      ...(issuedSecret ? { deviceSecret: issuedSecret } : {}),
      subscriptions: subscriptions.map(
        ({ festivalId, packUpdates, festivalStarts }) => ({
          festivalId,
          packUpdates,
          festivalStarts,
        }),
      ),
    };
  }

  async get(id: string, userId: string | null, secret?: string) {
    const device = await this.ownedDevice(id, userId, secret);
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

  async remove(id: string, userId: string | null, secret?: string) {
    await this.ownedDevice(id, userId, secret);
    const result = await this.devices.delete(
      this.ownershipWhere(id, userId, secret),
    );
    if (result.affected !== 1)
      throw new ForbiddenException('기기 소유권을 확인할 수 없습니다.');
  }

  async startLiveActivity(
    id: string,
    body: LiveActivityDto,
    userId: string | null,
    secret?: string,
  ) {
    await this.ownedDevice(id, userId, secret);
    await this.publishedFestival(body.festivalId);
    const result = await this.devices.update(
      this.ownershipWhere(id, userId, secret),
      {
        liveActivityFestivalId: body.festivalId,
        liveActivityId: body.activityId,
        liveActivityPushToken: body.pushToken,
      },
    );
    if (result.affected !== 1)
      throw new ForbiddenException('기기 소유권을 확인할 수 없습니다.');
  }

  async stopLiveActivity(id: string, userId: string | null, secret?: string) {
    await this.ownedDevice(id, userId, secret);
    const result = await this.devices.update(
      this.ownershipWhere(id, userId, secret),
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
    userId: string | null,
    secret?: string,
  ) {
    await this.ownedDevice(id, userId, secret);
    await this.publishedFestival(festivalId);
    await this.subscriptions.save({
      deviceId: id,
      festivalId,
      packUpdates: body.packUpdates,
      festivalStarts: body.festivalStarts,
    });
    return {
      festivalId,
      packUpdates: body.packUpdates,
      festivalStarts: body.festivalStarts,
    };
  }

  async listSubscriptions(id: string, userId: string | null, secret?: string) {
    await this.ownedDevice(id, userId, secret);
    const subscriptions = await this.subscriptions.find({
      where: { deviceId: id },
    });
    return {
      items: subscriptions.map(
        ({ festivalId, packUpdates, festivalStarts }) => ({
          festivalId,
          packUpdates,
          festivalStarts,
        }),
      ),
    };
  }

  async unsubscribe(
    id: string,
    festivalId: string,
    userId: string | null,
    secret?: string,
  ) {
    await this.ownedDevice(id, userId, secret);
    await this.subscriptions.delete({ deviceId: id, festivalId });
  }

  private requireId(id: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new BadRequestException('deviceId는 UUID v4여야 합니다.');
  }

  private async ownedDevice(
    id: string,
    userId: string | null,
    secret?: string,
  ): Promise<Device> {
    this.requireId(id);
    const device = await this.devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('등록되지 않은 기기입니다.');
    if (device.userId !== userId)
      throw new ForbiddenException('기기 소유자가 다릅니다.');
    const owned = await this.devices.findOne({
      where: this.ownershipWhere(id, userId, secret),
    });
    if (!owned)
      throw new ForbiddenException('기기 소유권을 확인할 수 없습니다.');
    return owned;
  }

  private ownershipWhere(
    id: string,
    userId: string | null,
    secret?: string,
  ): FindOptionsWhere<Device> {
    return {
      id,
      userId: userId === null ? IsNull() : userId,
      deviceSecretHash: this.hashSecret(secret),
    };
  }

  private hashSecret(secret: string | undefined): string {
    if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
      throw new ForbiddenException('기기 비밀값이 필요합니다.');
    }
    return createHash('sha256').update(secret, 'hex').digest('hex');
  }

  private async publishedFestival(id: string) {
    if (!/^fst_[0-9a-z]+$/.test(id))
      throw new BadRequestException('festivalId 형식이 올바르지 않습니다.');
    const festival = await this.festivals.findOne({ where: { id } });
    if (!festival?.published || festival.publishedVersion < 1)
      throw new NotFoundException('공개된 페스티벌을 찾을 수 없습니다.');
  }
}
