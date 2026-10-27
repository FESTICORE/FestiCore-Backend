import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImageStorageService } from '../../storage/image-storage.service';
import { AdminAuditModule } from '../audit/admin-audit.module';
import { CrawlController } from './controller/crawl.controller';
import { CrawlAlertController } from './controller/crawl-alert.controller';
import { CrawlTimetableController } from './controller/crawl-timetable.controller';
import { CrawlAlert } from './entity/crawl-alert.entity';
import { ProposalController } from './controller/proposal.controller';
import { CrawlImage } from './entity/crawl-image.entity';
import { CrawlRun } from './entity/crawl-run.entity';
import { CrawlSnapshot } from './entity/crawl-snapshot.entity';
import { CrawlSource } from './entity/crawl-source.entity';
import { CrawlTimetableRevision } from './entity/crawl-timetable-revision.entity';
import { CrawlLineupRevision } from './entity/crawl-lineup-revision.entity';
import { CrawlLineupController } from './controller/crawl-lineup.controller';
import { CrawlLineupRevisionService } from './service/crawl-lineup-revision.service';
import { Proposal } from './entity/proposal.entity';
import { CrawlService } from './service/crawl.service';
import { CrawlAlertService } from './service/crawl-alert.service';
import { ProposalService } from './service/proposal.service';
import { CrawlTimetableRevisionService } from './service/crawl-timetable-revision.service';
import { PublicFestivalModule } from '../../public/public-festival.module';

@Module({
  imports: [
    AdminAuditModule,
    PublicFestivalModule,
    TypeOrmModule.forFeature([
      CrawlSource,
      CrawlRun,
      CrawlSnapshot,
      CrawlImage,
      Proposal,
      CrawlAlert,
      CrawlTimetableRevision,
      CrawlLineupRevision,
    ]),
  ],
  controllers: [
    CrawlController,
    ProposalController,
    CrawlAlertController,
    CrawlTimetableController,
    CrawlLineupController,
  ],
  providers: [
    CrawlService,
    ProposalService,
    CrawlAlertService,
    ImageStorageService,
    CrawlTimetableRevisionService,
    CrawlLineupRevisionService,
  ],
  exports: [TypeOrmModule],
})
export class CrawlModule {}
