import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminFestivalController } from './admin-festival.controller';
import { AdminFestivalMapController } from './admin-festival-map.controller';
import { AdminFestivalService } from './admin-festival.service';
import { AdminFestival, AdminFestivalVersion } from './festival.entity';
import { ImageStorageService } from '../../storage/image-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdminFestival, AdminFestivalVersion])],
  controllers: [AdminFestivalController, AdminFestivalMapController],
  providers: [AdminFestivalService, ImageStorageService],
  exports: [AdminFestivalService],
})
export class AdminFestivalModule {}
