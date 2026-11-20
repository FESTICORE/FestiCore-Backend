import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApnsService } from './apns.service';
import { FestivalStartService } from './festival-start.service';
import { InstagramGraphClient } from './instagram-graph.client';
import {
  OfficialInstagramFeed,
  OfficialInstagramPost,
} from './official-news.entity';
import { OfficialNewsService } from './official-news.service';
import { LiveActivityService } from './live-activity.service';
import { SocialNotificationService } from './social-notification.service';
import { UserNotificationController } from './user-notification.controller';
import { UserNotification } from './user-notification.entity';
import { UserNotificationService } from './user-notification.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      UserNotification,
      OfficialInstagramFeed,
      OfficialInstagramPost,
    ]),
  ],
  controllers: [UserNotificationController],
  providers: [
    ApnsService,
    FestivalStartService,
    SocialNotificationService,
    LiveActivityService,
    UserNotificationService,
    InstagramGraphClient,
    OfficialNewsService,
  ],
  exports: [
    OfficialNewsService,
    SocialNotificationService,
    LiveActivityService,
    FestivalStartService,
  ],
})
export class NotificationModule {}
