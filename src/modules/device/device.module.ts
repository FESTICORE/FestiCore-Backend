import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entity/user.entity';
import { AdminFestival } from '../admin/festival/festival.entity';
import { DeviceController } from './device.controller';
import { NotificationSubscriptionController } from './notification-subscription.controller';
import { Device, DeviceSubscription } from './device.entity';
import { DeviceService } from './device.service';
import { DeviceAuthGuard } from './device-auth.guard';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, DeviceSubscription, AdminFestival, User]),
    JwtModule.register({}),
    NotificationModule,
  ],
  controllers: [DeviceController, NotificationSubscriptionController],
  providers: [DeviceService, DeviceAuthGuard],
  exports: [TypeOrmModule, DeviceAuthGuard, DeviceService],
})
export class DeviceModule {}
