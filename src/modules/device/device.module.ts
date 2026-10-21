import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { DeviceController } from './device.controller';
import { NotificationSubscriptionController } from './notification-subscription.controller';
import { Device, DeviceSubscription } from './device.entity';
import { DeviceService } from './device.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, DeviceSubscription, AdminFestival]),
  ],
  controllers: [DeviceController, NotificationSubscriptionController],
  providers: [DeviceService],
  exports: [TypeOrmModule],
})
export class DeviceModule {}
