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
import { Proposal } from './entity/proposal.entity';
import { CrawlService } from './service/crawl.service';
import { CrawlAlertService } from './service/crawl-alert.service';
import { ProposalService } from './service/proposal.service';
import { CrawlTimetableRevisionService } from './service/crawl-timetable-revision.service';

@Module({
  imports: [
    AdminAuditModule,
    TypeOrmModule.forFeature([
      CrawlSource,
      CrawlRun,
      CrawlSnapshot,
      CrawlImage,
      Proposal,
      CrawlAlert,
      CrawlTimetableRevision,
    ]),
  ],
  controllers: [
    CrawlController,
    ProposalController,
    CrawlAlertController,
    CrawlTimetableController,
  ],
  providers: [
    CrawlService,
    ProposalService,
    CrawlAlertService,
    ImageStorageService,
    CrawlTimetableRevisionService,
  ],
  exports: [TypeOrmModule],
})
export class CrawlModule {}
