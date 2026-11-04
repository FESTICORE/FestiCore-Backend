import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PublicFestivalService } from '../../public/public-festival.service';
import { AdminFestivalService } from './admin-festival.service';

/* eslint-disable @typescript-eslint/no-require-imports -- 배포 이미지에도 포함되는 기존 발행 스크립트의 검증 함수를 공유한다. */
const { buildDraft } =
  require('../../../../scripts/publish-stage-festivals.cjs') as {
    buildDraft: (
      detail: unknown,
      fillMissingEnds: boolean,
    ) => string | { days: unknown[]; stages: unknown[]; sets: unknown[] };
  };

const POLL_MS = 60 * 60 * 1000;

@Injectable()
export class AutoPublishVerifiedService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutoPublishVerifiedService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly publicFestivals: PublicFestivalService,
    private readonly adminFestivals: AdminFestivalService,
  ) {}

  onModuleInit() {
    if (
      process.env.AUTO_PUBLISH_VERIFIED_TIMETABLE !== 'true' ||
      process.env.PUBLIC_URL !== 'https://festicore-dev.up.railway.app'
    )
      return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      let after: string | undefined;
      const discovered: { id: string; name: string; firstDate: string }[] = [];
      for (let page = 0; page < 100; page += 1) {
        const result = await this.publicFestivals.list(after, '50');
        discovered.push(
          ...result.items.filter(
            (
              item,
            ): item is (typeof result.items)[number] & {
              status: 'discovered';
              name: string;
            } => item.status === 'discovered' && typeof item.name === 'string',
          ),
        );
        after = result.nextCursor ?? undefined;
        if (!after) break;
        if (page === 99) throw new Error('축제 목록 100페이지 제한 초과');
      }
      const counts = new Map<string, number>();
      const keyFor = (festival: { name: string; firstDate: string }) =>
        `${festival.name.trim().toLocaleLowerCase()}\u0000${festival.firstDate}`;
      for (const festival of discovered) {
        const key = keyFor(festival);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const festival of discovered) {
        if ((counts.get(keyFor(festival)) ?? 0) > 1) {
          this.logger.warn(
            `자동 발행 보류 ${festival.id}: 동일 이름·시작일의 발견 축제가 중복됨`,
          );
          continue;
        }
        try {
          const detail = await this.publicFestivals.detail(festival.id);
          if (detail.status !== 'discovered') continue;
          const draft = buildDraft(detail, false);
          if (typeof draft === 'string') {
            this.logger.log(`자동 발행 보류 ${festival.id}: ${draft}`);
            continue;
          }
          // 가져오기에서 이미 관리 중인 ID는 충돌로 중단한다. 관리자의 초안은 수정하지 않는다.
          const imported = await this.adminFestivals.importDiscovered(
            festival.id,
            {},
            null,
          );
          const patched = await this.adminFestivals.patch(
            festival.id,
            draft,
            `"d${imported.draftVersion}"`,
            null,
          );
          const published = await this.adminFestivals.publish(
            festival.id,
            '공개 상세의 승인된 공식 시간표 자동 발행',
            `"d${patched.draftVersion}"`,
            null,
          );
          this.logger.log(
            `자동 발행 ${festival.id}: 팩 버전 ${published.packVersion}`,
          );
        } catch (error) {
          // 실패한 신규 초안도 자동 재수정하지 않고 관리자 검토를 기다린다.
          this.logger.warn(
            `자동 발행 보류 ${festival.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.logger.log(`자동 발행 점검 완료: 발견 축제 ${discovered.length}개`);
    } catch (error) {
      this.logger.error(
        `자동 발행 점검 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
