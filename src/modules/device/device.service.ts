import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
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
  ) {}

  async register(id: string, body: RegisterDeviceDto, userId: string) {
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
    if (!device) {
      try {
        await this.devices.insert({
          id,
          userId,
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
      if (device.userId !== userId)
        throw new ForbiddenException('기기 소유자가 다릅니다.');
      const update = await this.devices.update({ id, userId }, values);
      if (update.affected !== 1) {
        throw new ForbiddenException('기기 소유권을 확인할 수 없습니다.');
      }
    }
    const subscriptions = await this.subscriptions.find({
      where: { deviceId: id },
    });
    return {
      deviceId: id,
      userId,
      subscriptions: subscriptions.map(
        ({ festivalId, packUpdates, festivalStarts }) => ({
          festivalId,
          packUpdates,
          festivalStarts,
        }),
      ),
    };
  }

  async get(id: string, userId: string) {
    const device = await this.ownedDevice(id, userId);
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

  async remove(id: string, userId: string) {
    await this.ownedDevice(id, userId);
    const result = await this.devices.delete({ id, userId });
    if (result.affected !== 1)
      throw new ForbiddenException('기기 소유권을 확인할 수 없습니다.');
  }

  async startLiveActivity(id: string, body: LiveActivityDto, userId: string) {
    await this.ownedDevice(id, userId);
    await this.publishedFestival(body.festivalId);
    const result = await this.devices.update(
      { id, userId },
      {
        liveActivityFestivalId: body.festivalId,
        liveActivityId: body.activityId,
        liveActivityPushToken: body.pushToken,
      },
    );
    if (result.affected !== 1)
      throw new ForbiddenException('기기 소유권을 확인할 수 없습니다.');
  }

  async stopLiveActivity(id: string, userId: string) {
    await this.ownedDevice(id, userId);
    const result = await this.devices.update(
      { id, userId },
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
    userId: string,
  ) {
    await this.ownedDevice(id, userId);
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

  async listSubscriptions(id: string, userId: string) {
    await this.ownedDevice(id, userId);
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

  async unsubscribe(id: string, festivalId: string, userId: string) {
    await this.ownedDevice(id, userId);
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

  private async ownedDevice(id: string, userId: string): Promise<Device> {
    this.requireId(id);
    const device = await this.devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('등록되지 않은 기기입니다.');
    if (device.userId !== userId)
      throw new ForbiddenException('기기 소유자가 다릅니다.');
    return device;
  }

  private async publishedFestival(id: string) {
    if (!/^fst_[0-9a-z]+$/.test(id))
      throw new BadRequestException('festivalId 형식이 올바르지 않습니다.');
    const festival = await this.festivals.findOne({ where: { id } });
    if (!festival?.published || festival.publishedVersion < 1)
      throw new NotFoundException('공개된 페스티벌을 찾을 수 없습니다.');
  }
}
