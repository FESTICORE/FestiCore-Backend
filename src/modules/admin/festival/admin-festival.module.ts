import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminFestivalController } from './admin-festival.controller';
import { AdminFestivalService } from './admin-festival.service';
import { AdminFestival, AdminFestivalVersion } from './festival.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AdminFestival, AdminFestivalVersion])],
  controllers: [AdminFestivalController],
  providers: [AdminFestivalService],
  exports: [AdminFestivalService],
})
export class AdminFestivalModule {}
