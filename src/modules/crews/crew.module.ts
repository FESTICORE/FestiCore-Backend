import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { User } from '../auth/entity/user.entity';
import { CurrentTermsGuard } from '../auth/guard/current-terms.guard';
import { CrewController } from './crew.controller';
import { CrewArchiveService } from './crew-archive.service';
import {
  Crew,
  CrewGather,
  CrewMember,
  CrewStatusIdempotency,
} from './crew.entity';
import { CrewService } from './crew.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    NotificationModule,
    TypeOrmModule.forFeature([
      Crew,
      CrewMember,
      CrewGather,
      CrewStatusIdempotency,
      AdminFestival,
      User,
    ]),
  ],
  controllers: [CrewController],
  providers: [CrewService, CrewArchiveService, CurrentTermsGuard],
  exports: [CrewService],
})
export class CrewModule {}
