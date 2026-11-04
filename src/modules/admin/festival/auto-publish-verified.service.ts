import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicFestivalService } from '../../public/public-festival.service';
import {
  AdminFestivalService,
  CrawledFestivalTimetable,
} from './admin-festival.service';

/* eslint-disable @typescript-eslint/no-require-imports -- 기존 시간표 검증을 수동 발행 스크립트와 공유한다. */
const { buildDraft } =
  require('../../../../scripts/publish-stage-festivals.cjs') as {
    buildDraft: (
      detail: unknown,
      fillMissingEnds: boolean,
    ) => string | CrawledFestivalTimetable;
  };
const POLL_MS = 5 * 60 * 1000;
const DEBOUNCE_MS = 1_000;

@Injectable()
export class AutoPublishVerifiedService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutoPublishVerifiedService.name);
  private timer?: NodeJS.Timeout;
  private pendingTimer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private pending = false;
  private stopped = false;

  constructor(
    private readonly publicFestivals: PublicFestivalService,
    private readonly adminFestivals: AdminFestivalService,
    private readonly config: ConfigService,
  ) {}

  private enabled(): boolean {
    return (
      !this.stopped &&
      this.config.get<string>('PUBLIC_URL') ===
        'https://festicore-dev.up.railway.app' &&
      this.config.get<string>('AUTO_PUBLISH_VERIFIED_TIMETABLE') !== 'false'
    );
  }

  onModuleInit() {
    if (!this.enabled()) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
  }

  /** 실행·소스 저장까지 끝난 성공 크롤만 호출한다. 연속 성공은 한 번의 재조회로 합친다. */
  requestAfterCrawl(): void {
    if (!this.enabled()) return;
    if (this.running) {
      this.pending = true;
      return;
    }
    if (this.pendingTimer) return;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = undefined;
      void this.tick();
    }, DEBOUNCE_MS);
    this.pendingTimer.unref();
  }

  async tick(): Promise<void> {
    if (!this.enabled()) return;
    if (this.running) {
      this.pending = true;
      return this.running;
    }
    this.running = this.reconcile().finally(() => {
      this.running = undefined;
      if (this.pending) {
        this.pending = false;
        this.requestAfterCrawl();
      }
    });
    return this.running;
  }

  private async reconcile(): Promise<void> {
    try {
      const festivals = await this.publicFestivals.crawlCandidates();
      let changed = 0;
      for (const festival of festivals) {
        if (!this.enabled()) break;
        try {
          const detail = await this.publicFestivals.crawlDetail(festival.id);
          if (!detail) continue;
          const timetable = buildDraft(detail, false);
          const result = await this.adminFestivals.publishCrawled(
            detail,
            typeof timetable === 'string' ? null : timetable,
          );
          if (result.changed) {
            changed += 1;
            this.logger.log(
              `자동 발행 ${festival.id}: 팩 버전 ${result.packVersion}`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `자동 발행 실패 ${festival.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.logger.log(
        `자동 발행 점검 완료: ${festivals.length}개 확인, ${changed}개 갱신`,
      );
    } catch (error) {
      this.logger.error(
        `자동 발행 점검 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
