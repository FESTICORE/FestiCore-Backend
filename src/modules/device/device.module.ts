import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { User } from '../auth/entity/user.entity';
import { DeviceController } from './device.controller';
import { Device, DeviceSubscription } from './device.entity';
import { DeviceService } from './device.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, DeviceSubscription, AdminFestival, User]),
    JwtModule.register({}),
    ConfigModule,
  ],
  controllers: [DeviceController],
  providers: [DeviceService],
  exports: [TypeOrmModule],
})
export class DeviceModule {}
