import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { Crew, CrewGather, CrewMember } from './crew.entity';

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
  ) {}

  onModuleInit() {
    void this.run().catch((error: unknown) =>
      this.logger.error('크루 아카이브 실패', error),
    );
    this.timer = setInterval(() => {
      void this.run().catch((error: unknown) =>
        this.logger.error('크루 아카이브 실패', error),
      );
    }, 60 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<void> {
    const crews = await this.crews.find();
    for (const crew of crews) {
      if (!crew.archivedAt) {
        const festival = await this.festivals.findOne({
          where: { id: crew.festivalId },
        });
        const days = festival?.published?.days;
        const ends = Array.isArray(days)
          ? days
              .map((day: unknown) =>
                day &&
                typeof day === 'object' &&
                'endsAt' in day &&
                typeof day.endsAt === 'string'
                  ? Date.parse(day.endsAt)
                  : NaN,
              )
              .filter(Number.isFinite)
          : [];
        if (ends.length && now.getTime() >= Math.max(...ends) + DAY_MS) {
          crew.archivedAt = now;
          await this.crews.save(crew);
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
