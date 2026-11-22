import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApnsService } from './apns.service';
import { FcmService } from './fcm.service';
import { PushService } from './push.service';

/** APNs · FCM 발송기를 앱 전체에서 한 인스턴스로 쓴다. */
@Module({
  imports: [ConfigModule],
  providers: [ApnsService, FcmService, PushService],
  exports: [ApnsService, FcmService, PushService],
})
export class PushModule {}
