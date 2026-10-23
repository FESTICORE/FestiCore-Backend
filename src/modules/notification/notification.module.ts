import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApnsService } from './apns.service';
import { FestivalStartService } from './festival-start.service';
import { SocialNotificationService } from './social-notification.service';

@Module({
  imports: [ConfigModule],
  providers: [ApnsService, FestivalStartService, SocialNotificationService],
  exports: [SocialNotificationService],
})
export class NotificationModule {}
