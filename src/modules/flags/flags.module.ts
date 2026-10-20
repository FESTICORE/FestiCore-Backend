import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { User } from '../auth/entity/user.entity';
import {
  BearerController,
  FlagsController,
  MyFlagsController,
  AdminFlagsController,
} from './flags.controller';
import {
  Flag,
  FlagBearer,
  FlagBearerCode,
  FlagClaimAttempt,
  FlagClaimBudget,
  FlagFollow,
  FlagIdempotency,
  FlagPin,
  FlagReport,
  FlagStatusEvent,
} from './flag.entity';
import { FlagsService } from './flags.service';
import { FlagClaimThrottleService } from './flag-claim-throttle.service';
import { ImageStorageService } from '../storage/image-storage.service';
import { FlagPackSyncService } from './flag-pack-sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Flag,
      FlagFollow,
      FlagIdempotency,
      FlagPin,
      FlagBearer,
      FlagBearerCode,
      FlagClaimAttempt,
      FlagClaimBudget,
      FlagReport,
      FlagStatusEvent,
      AdminFestival,
      User,
    ]),
    JwtModule.register({}),
  ],
  controllers: [
    FlagsController,
    BearerController,
    MyFlagsController,
    AdminFlagsController,
  ],
  providers: [
    FlagsService,
    FlagClaimThrottleService,
    FlagPackSyncService,
    ImageStorageService,
  ],
  exports: [FlagsService, TypeOrmModule],
})
export class FlagsModule {}
