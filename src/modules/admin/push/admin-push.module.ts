import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../../device/device.entity';
import { ApnsService } from '../../notification/apns.service';
import { AdminAuditModule } from '../audit/admin-audit.module';
import { AdminPushController } from './admin-push.controller';
import { AdminPushService } from './admin-push.service';

@Module({
  imports: [TypeOrmModule.forFeature([Device]), AdminAuditModule],
  controllers: [AdminPushController],
  providers: [AdminPushService, ApnsService],
})
export class AdminPushModule {}
