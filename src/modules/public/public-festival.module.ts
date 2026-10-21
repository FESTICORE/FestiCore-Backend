import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AdminFestival } from '../admin/festival/festival.entity';
import { Crew, CrewGather, CrewMember } from '../crews/crew.entity';
import { Flag, FlagBearer, FlagFollow, FlagPin } from '../flags/flag.entity';
import { PublicFestivalController } from './public-festival.controller';
import { PublicFestivalMapController } from './public-festival-map.controller';
import { ImageStorageService } from '../storage/image-storage.service';
import { PublicFestivalService } from './public-festival.service';
import { PublicLiveService } from './public-live.service';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([
      AdminFestival,
      Flag,
      FlagFollow,
      FlagPin,
      FlagBearer,
      Crew,
      CrewMember,
      CrewGather,
    ]),
  ],
  controllers: [PublicFestivalController, PublicFestivalMapController],
  providers: [PublicFestivalService, PublicLiveService, ImageStorageService],
})
export class PublicFestivalModule {}
