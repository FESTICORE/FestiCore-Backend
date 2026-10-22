import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Device } from '../../device/device.entity';
import { ApnsService } from '../../notification/apns.service';
import { AdminAuditService } from '../audit/admin-audit.service';
import { TestPushDto } from './admin-push.dto';

@Injectable()
export class AdminPushService {
  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly apns: ApnsService,
    private readonly audit: AdminAuditService,
    private readonly dataSource: DataSource,
  ) {}

  async sendTest(input: TestPushDto, actor: string | null) {
    if (!this.apns.isConfigured()) {
      throw new ServiceUnavailableException(
        'APNs 설정이 없어 테스트 푸시를 보낼 수 없습니다.',
      );
    }
    const device = await this.devices.findOne({
      where: { id: input.deviceId },
      select: { id: true, apnsToken: true, apnsEnvironment: true },
    });
    if (!device) throw new NotFoundException('등록된 기기를 찾을 수 없습니다.');
    if (!device.apnsToken || !device.apnsEnvironment) {
      throw new ConflictException(
        '기기에 APNs 토큰과 환경이 등록되지 않았습니다.',
      );
    }

    // 외부 전송에 앞서 요청을 기록한다. 토큰과 비밀값은 감사 기록에 포함하지 않는다.
    await this.dataSource.transaction((manager) =>
      this.audit.record(manager, {
        actor,
        action: 'push.test.requested',
        target: `device:${device.id}`,
        before: null,
        after: { type: input.type },
      }),
    );
    const result = await this.apns.sendTestNotification(
      device.apnsToken,
      device.apnsEnvironment,
      input.type,
    );
    return {
      deviceId: device.id,
      type: input.type,
      accepted: result.accepted,
      reason: result.accepted ? null : (result.reason ?? 'APNS_REJECTED'),
    };
  }
}
