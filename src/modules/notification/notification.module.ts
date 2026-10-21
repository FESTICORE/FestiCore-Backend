import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApnsService } from './apns.service';
import { FestivalStartService } from './festival-start.service';

@Module({
  imports: [ConfigModule],
  providers: [ApnsService, FestivalStartService],
})
export class NotificationModule {}
