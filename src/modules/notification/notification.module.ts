import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FestivalStartService } from './festival-start.service';
import { InstagramGraphClient } from './instagram-graph.client';
import {
  OfficialInstagramFeed,
  OfficialInstagramPost,
} from './official-news.entity';
import { OfficialNewsService } from './official-news.service';
import { LiveActivityService } from './live-activity.service';
import { PushModule } from './push.module';
import { SocialNotificationService } from './social-notification.service';
import { UserNotificationController } from './user-notification.controller';
import { UserNotification } from './user-notification.entity';
import { UserNotificationService } from './user-notification.service';

@Module({
  imports: [
    ConfigModule,
    PushModule,
    TypeOrmModule.forFeature([
      UserNotification,
      OfficialInstagramFeed,
      OfficialInstagramPost,
    ]),
  ],
  controllers: [UserNotificationController],
  providers: [
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
