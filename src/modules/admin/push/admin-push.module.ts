import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../../device/device.entity';
import { PushModule } from '../../notification/push.module';
import { AdminAuditModule } from '../audit/admin-audit.module';
import { AdminPushController } from './admin-push.controller';
import { AdminPushService } from './admin-push.service';

@Module({
  imports: [TypeOrmModule.forFeature([Device]), AdminAuditModule, PushModule],
  controllers: [AdminPushController],
  providers: [AdminPushService],
})
export class AdminPushModule {}
