import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminFestivalController } from './admin-festival.controller';
import { AdminFestivalMapController } from './admin-festival-map.controller';
import { AdminFestivalImageController } from './admin-festival-image.controller';
import { AdminFestivalService } from './admin-festival.service';
import { TimetableImageService } from './timetable-image.service';
import { AdminFestival, AdminFestivalVersion } from './festival.entity';
import { ImageStorageService } from '../../storage/image-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdminFestival, AdminFestivalVersion])],
  controllers: [
    AdminFestivalController,
    AdminFestivalMapController,
    AdminFestivalImageController,
  ],
  providers: [AdminFestivalService, ImageStorageService, TimetableImageService],
  exports: [AdminFestivalService],
})
export class AdminFestivalModule {}
