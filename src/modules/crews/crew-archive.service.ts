import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { LiveActivityService } from '../notification/live-activity.service';
import {
  Crew,
  CrewGather,
  CrewMember,
  CrewStatusIdempotency,
} from './crew.entity';
import { crewArchiveTime } from './crew-archive-time';

const DAY_MS = 24 * 60 * 60_000;

@Injectable()
export class CrewArchiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrewArchiveService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(Crew) private readonly crews: Repository<Crew>,
    @InjectRepository(CrewMember)
    private readonly members: Repository<CrewMember>,
    @InjectRepository(CrewGather)
    private readonly gathers: Repository<CrewGather>,
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    @InjectRepository(CrewStatusIdempotency)
    private readonly idempotency: Repository<CrewStatusIdempotency>,
    private readonly liveActivity: LiveActivityService,
  ) {}

  onModuleInit() {
    void this.run().catch(() => this.logger.error('크루 아카이브 실패'));
    this.timer = setInterval(() => {
      void this.run().catch(() => this.logger.error('크루 아카이브 실패'));
    }, 60 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<void> {
    await this.idempotency.delete({ expiresAt: LessThan(now) });
    const crews = await this.crews.find();
    for (const crew of crews) {
      if (!crew.archivedAt) {
        const festival = await this.festivals.findOne({
          where: { id: crew.festivalId },
        });
        if (now.getTime() >= crewArchiveTime(festival?.published?.days)) {
          await this.crews.manager.transaction(async (manager) => {
            const archived = await manager
              .getRepository(Crew)
              .update(
                { id: crew.id, archivedAt: IsNull() },
                { archivedAt: now },
              );
            if (archived.affected)
              await this.liveActivity.enqueueCrewMembers(
                crew.id,
                crew.festivalId,
                manager,
              );
          });
        }
      }
      if (
        crew.archivedAt &&
        now.getTime() >= crew.archivedAt.getTime() + 30 * DAY_MS
      ) {
        await this.members.update(
          { crewId: crew.id },
          { zoneId: null, state: null, statusUpdatedAt: null },
        );
        await this.gathers.delete({ crewId: crew.id });
      }
    }
  }
}
