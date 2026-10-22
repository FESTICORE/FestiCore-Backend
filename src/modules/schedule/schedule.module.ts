import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { ScheduleController } from './schedule.controller';
import { UserSchedule } from './schedule.entity';
import { ScheduleService } from './schedule.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserSchedule, AdminFestival])],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [TypeOrmModule],
})
export class ScheduleModule {}
