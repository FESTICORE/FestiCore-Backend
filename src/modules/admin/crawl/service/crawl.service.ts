import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { AdminFestival } from '../../festival/festival.entity';
import { AdminAuditService } from '../../audit/admin-audit.service';
import { ImageStorageService } from '../../../storage/image-storage.service';
import {
  CreateCrawlSourceDto,
  UpdateCrawlSourceDto,
} from '../dto/crawl-source.dto';
import { CrawlRun } from '../entity/crawl-run.entity';
import { CrawlImage } from '../entity/crawl-image.entity';
import { CrawlSnapshot } from '../entity/crawl-snapshot.entity';
import { CrawlSource } from '../entity/crawl-source.entity';
import { Proposal, ProposalItem } from '../entity/proposal.entity';
import { checkedUrl, robotsAllows, safeGet, safeGetImage } from './crawl-fetch';
import {
  discoverImageUrls,
  prepareCrawlImage,
  selectRunImages,
} from './crawl-image';
import { parseCrawl, plainText } from './crawl-parser';
import { CrawlAlertService } from './crawl-alert.service';

const kstDay = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

const YES24_PAGE_LIMIT = 4;

function yes24PageCount(sourceUrl: string, body: string): number {
  const url = new URL(sourceUrl);
  if (
    url.hostname !== 'ticket.yes24.com' ||
    url.pathname !== '/New/Genre/Ajax/GenreList_Data.aspx' ||
    url.searchParams.get('genre') !== '15464' ||
    url.searchParams.get('pCurPage') !== '1'
  )
    return 1;
  const pageSize = Number(url.searchParams.get('pPageSize'));
  const total = Number(
    /<input\b[^>]*\bid=["']ListTotalCnt["'][^>]*\bvalue=["'](\d+)["']/i.exec(
      body,
    )?.[1],
  );
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return 1;
  if (!Number.isSafeInteger(total) || total <= pageSize) return 1;
  return Math.min(Math.ceil(total / pageSize), YES24_PAGE_LIMIT);
}

@Injectable()
export class CrawlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrawlService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(CrawlSource)
    private readonly sourcesRepo: Repository<CrawlSource>,
    @InjectRepository(CrawlRun) private readonly runsRepo: Repository<CrawlRun>,
    @InjectRepository(CrawlSnapshot)
    private readonly snapshotsRepo: Repository<CrawlSnapshot>,
    @InjectRepository(CrawlImage)
    private readonly imageRepo: Repository<CrawlImage>,
    @InjectRepository(Proposal)
    private readonly proposalsRepo: Repository<Proposal>,
    private readonly dataSource: DataSource,
    private readonly imageStorage: ImageStorageService,
    private readonly alerts: CrawlAlertService,
    private readonly audit: AdminAuditService,
  ) {}

  onModuleInit() {
    // 부팅 직후와 이후 매분 점검하므로 자정에 프로세스가 내려갔어도 당일 미실행분을 처리한다.
    this.timer = setInterval(
      () =>
        void this.scheduleDue().catch(() =>
          this.logger.error('예약 크롤 점검 실패'),
        ),
      60_000,
    );
    this.timer.unref();
    void this.scheduleDue().catch(() =>
      this.logger.error('예약 크롤 점검 실패'),
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sources(festivalId?: string, status?: string) {
    const qb = this.sourcesRepo.createQueryBuilder('source');
    if (festivalId)
      qb.andWhere('source.festivalId = :festivalId', { festivalId });
    if (status) qb.andWhere('source.status = :status', { status });
    return { items: await qb.orderBy('source.createdAt', 'DESC').getMany() };
  }

  async createSource(dto: CreateCrawlSourceDto, actor: string | null) {
    const parsers: Record<CrawlSource['kind'], CrawlSource['parser']> = {
      discovery: 'ticket-list',
      timetable: 'html-table',
      notice: 'html-text',
      directions: 'html-text',
      days: 'regex-days',
    };
    if (dto.parser !== parsers[dto.kind]) {
      throw new UnprocessableEntityException(
        '소스 종류와 파서가 맞지 않습니다.',
      );
    }
    if (dto.kind !== 'discovery' && !dto.festivalId) {
      throw new UnprocessableEntityException('festivalId가 필요합니다.');
    }
    if (dto.kind === 'discovery' && dto.festivalId) {
      throw new UnprocessableEntityException(
        '발견 소스에는 festivalId를 지정할 수 없습니다.',
      );
    }
    if (
      dto.festivalId &&
      !(await this.dataSource
        .getRepository(AdminFestival)
        .existsBy({ id: dto.festivalId }))
    ) {
      throw new UnprocessableEntityException('축제 초안을 찾을 수 없습니다.');
    }
    await this.checkRobots(dto.url);
    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(CrawlSource).save(
        manager.getRepository(CrawlSource).create({
          festivalId: dto.festivalId ?? null,
          kind: dto.kind,
          url: dto.url,
          parser: dto.parser,
          parserConfig: dto.parserConfig,
          enabled: true,
          status: 'ok',
        }),
      );
      await this.audit.record(manager, {
        actor,
        action: 'crawl.source.created',
        target: `crawl-source:${saved.id}`,
        before: null,
        after: this.sourceAuditSnapshot(saved),
      });
      return saved;
    });
  }

  async updateSource(
    id: string,
    dto: UpdateCrawlSourceDto,
    actor: string | null,
  ) {
    const source = await this.getSource(id);
    if (dto.url && dto.url !== source.url) await this.checkRobots(dto.url);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CrawlSource);
      const locked = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('크롤 소스를 찾을 수 없습니다.');
      const before = this.sourceAuditSnapshot(locked);
      Object.assign(locked, dto);
      if (dto.enabled !== undefined)
        locked.status = dto.enabled ? 'ok' : 'disabled';
      const saved = await repo.save(locked);
      await this.audit.record(manager, {
        actor,
        action: 'crawl.source.updated',
        target: `crawl-source:${id}`,
        before,
        after: this.sourceAuditSnapshot(saved),
      });
      return saved;
    });
  }

  async runNow(id: string, actor: string | null = null) {
    const source = await this.getSource(id);
    await this.dataSource.transaction((manager) =>
      this.audit.record(manager, {
        actor,
        action: 'crawl.run.requested',
        target: `crawl-source:${id}`,
        before: null,
        after: { sourceId: id },
      }),
    );
    await this.failStaleManualRun(source.id);
    const insert = await this.runsRepo
      .createQueryBuilder()
      .insert()
      .values({ sourceId: source.id })
      .orIgnore()
      .returning('*')
      .execute();
    if (!insert.identifiers.length) {
      const running = await this.runsRepo.findOneBy({
        sourceId: source.id,
        result: 'running',
      });
      if (running) return { runId: running.id };
      throw new Error('동시에 실행된 크롤을 확인하지 못했습니다.');
    }
    const run = await this.runsRepo.findOneByOrFail({
      id: insert.identifiers[0].id as string,
    });
    void this.execute(run, source).catch(() =>
      this.logger.error('수동 크롤 실패'),
    );
    return { runId: run.id };
  }

  private sourceAuditSnapshot(source: CrawlSource) {
    return {
      id: source.id,
      festivalId: source.festivalId,
      kind: source.kind,
      url: source.url,
      parser: source.parser,
      parserConfig: source.parserConfig,
      enabled: source.enabled,
      status: source.status,
    };
  }

  async testSource(id: string) {
    const source = await this.getSource(id);
    await this.checkRobots(source.url);
    const response = await this.getListing(source);
    if (response.status !== 200)
      throw new UnprocessableEntityException(`HTTP ${response.status}`);
    return {
      parsed: await parseCrawl(source, response.body),
      excerpt: plainText(response.body).slice(0, 500),
    };
  }

  async runs(sourceId?: string, result?: string, limit?: string) {
    const qb = this.runsRepo.createQueryBuilder('run');
    if (sourceId) qb.andWhere('run.sourceId = :sourceId', { sourceId });
    if (result) qb.andWhere('run.result = :result', { result });
    const count = Number(limit ?? 50);
    return {
      items: await qb
        .orderBy('run.startedAt', 'DESC')
        .take(Number.isInteger(count) ? Math.min(Math.max(count, 1), 100) : 50)
        .getMany(),
    };
  }

  async snapshot(id: string) {
    const row = await this.snapshotsRepo.findOneBy({ id });
    if (!row || row.expiresAt <= new Date()) {
      throw new NotFoundException('스냅샷을 찾을 수 없습니다.');
    }
    return {
      id: row.id,
      runId: row.runId,
      body: (await this.imageStorage.readCrawlSnapshot(row.objectKey)).toString(
        'utf8',
      ),
      createdAt: row.createdAt,
    };
  }

  async images(runId?: string, sourceId?: string) {
    const qb = this.imageRepo.createQueryBuilder('image');
    if (runId) qb.andWhere('image.runId = :runId', { runId });
    if (sourceId) qb.andWhere('image.sourceId = :sourceId', { sourceId });
    const rows = await qb
      .orderBy('image.lastSeenAt', 'DESC')
      .take(100)
      .getMany();
    return { items: rows.map((row) => this.imageView(row)) };
  }

  async image(id: string): Promise<Buffer> {
    const row = await this.imageRepo
      .createQueryBuilder('image')
      .addSelect('image.objectKey')
      .where('image.id = :id', { id })
      .getOne();
    if (!row) throw new NotFoundException('크롤 이미지를 찾을 수 없습니다.');
    return this.imageStorage.readCrawlImage(row.objectKey);
  }

  private imageView(row: CrawlImage) {
    return {
      id: row.id,
      sourceId: row.sourceId,
      runId: row.runId,
      originUrl: row.originUrl,
      imageUrl: `/api/v1/admin/crawl/images/${row.id}`,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
    };
  }

  private async scheduleDue() {
    const date = kstDay();
    const expired = await this.snapshotsRepo.find({
      where: { expiresAt: LessThan(new Date()) },
      take: 20,
    });
    for (const snapshot of expired) {
      try {
        await this.imageStorage.deleteCrawlSnapshot(snapshot.objectKey);
        await this.snapshotsRepo.delete(snapshot.id);
      } catch {
        this.logger.warn(`만료 스냅샷 정리 실패: ${snapshot.id}`);
      }
    }
    const sources = await this.sourcesRepo.findBy({
      enabled: true,
      status: In(['ok', 'broken']),
    });
    for (const source of sources) {
      // 자정 이후 새로 추가된 소스는 다음 자정부터 예약 실행한다.
      if (kstDay(source.createdAt) >= date) continue;
      // 실패한 소스도 다음 날 재시도한다. 당일 수동 실행 직후에는 중복 시도하지 않는다.
      if (
        source.status === 'broken' &&
        source.lastRunAt &&
        kstDay(source.lastRunAt) >= date
      )
        continue;
      await this.failStaleManualRun(source.id);
      // 일별 유니크 키가 복수 프로세스에서 같은 소스의 중복 예약을 막는다.
      const insert = await this.runsRepo
        .createQueryBuilder()
        .insert()
        .values({
          sourceId: source.id,
          scheduledDate: date,
        })
        .orIgnore()
        .returning('*')
        .execute();
      let runId = insert.identifiers[0]?.id as string | undefined;
      if (!runId) {
        // 프로세스가 실행 도중 종료되면 유니크 키가 당일 재예약을 막는다.
        // 정상 수집의 네트워크 제한보다 긴 15분이 지난 실행만 원자적으로 회수한다.
        const reclaimed = await this.runsRepo
          .createQueryBuilder()
          .update()
          .set({ startedAt: new Date(), error: null, finishedAt: null })
          .where('"sourceId" = :sourceId', { sourceId: source.id })
          .andWhere('"scheduledDate" = :date', { date })
          .andWhere('result = :running', { running: 'running' })
          .andWhere('"startedAt" < :staleBefore', {
            staleBefore: new Date(Date.now() - 15 * 60_000),
          })
          .returning('id')
          .execute();
        runId = (reclaimed.raw as { id: string }[])[0]?.id;
      }
      if (!runId) continue;
      const run = await this.runsRepo.findOneByOrFail({ id: runId });
      void this.execute(run, source).catch(() =>
        this.logger.error('예약 크롤 실패'),
      );
    }
  }

  private async failStaleManualRun(sourceId: string) {
    // 수동 실행 중 프로세스가 종료돼도 이후 예약 실행을 영구 차단하지 않는다.
    await this.runsRepo
      .createQueryBuilder()
      .update()
      .set({
        result: 'failed',
        finishedAt: new Date(),
        error: '실행 중 프로세스가 종료되거나 시간 제한을 초과했습니다.',
      })
      .where('"sourceId" = :sourceId', { sourceId })
      .andWhere('"scheduledDate" IS NULL')
      .andWhere('result = :running', { running: 'running' })
      .andWhere('"startedAt" < :staleBefore', {
        staleBefore: new Date(Date.now() - 15 * 60_000),
      })
      .execute();
  }

  private async execute(run: CrawlRun, source: CrawlSource) {
    let phase = 'ROBOTS';
    try {
      await this.checkRobots(source.url);
      phase = 'FETCH';
      if (source.parser === 'image-ocr') {
        await this.captureImages(source, run, [checkedUrl(source.url)]);
        throw new Error(
          '이미지는 보관했지만 OCR 파서는 아직 연동되지 않았습니다.',
        );
      }
      const response = await this.getListing(source);
      run.httpStatus = response.status;
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      phase = 'PROCESS';
      run.contentHash = createHash('sha256')
        .update(response.body)
        // Parser behavior is part of the snapshot identity. A parser release
        // must reprocess unchanged ticket pages instead of skipping them.
        .update(
          source.parser === 'ticket-list'
            ? source.url.startsWith(
                'https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx',
              )
              ? 'ticket-list:v4'
              : source.url.startsWith(
                    'https://ticket.melon.com/search/index.htm?',
                  )
                ? 'ticket-list:v4'
                : source.url.startsWith('https://nol.yanolja.com/ticket')
                  ? 'ticket-list:v4'
                  : 'ticket-list:v3'
            : '',
        )
        .digest('hex');
      const objectKey = `crawl/snapshots/${randomUUID()}.txt`;
      await this.imageStorage.saveCrawlSnapshot(
        objectKey,
        Buffer.from(response.body, 'utf8'),
      );
      const snapshot = await this.snapshotsRepo.save(
        this.snapshotsRepo.create({
          runId: run.id,
          objectKey,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }),
      );
      run.snapshotUrl = `/api/v1/admin/crawl/snapshots/${snapshot.id}`;
      const imageUrls = await this.captureImages(
        source,
        run,
        discoverImageUrls(response.body, source.url),
      );
      const previous = await this.runsRepo
        .createQueryBuilder('run')
        .where(
          'run.sourceId = :sourceId AND run.id != :id AND run.result != :failed',
          { sourceId: source.id, id: run.id, failed: 'failed' },
        )
        .orderBy('run.startedAt', 'DESC')
        .getOne();
      if (previous?.contentHash === run.contentHash) {
        run.result = 'unchanged';
      } else {
        phase = 'PARSE';
        const parsed = await parseCrawl(source, response.body);
        if (
          source.url === 'https://mintpaper.co.kr/festivals' &&
          Array.isArray(parsed)
        ) {
          for (const item of parsed as unknown[]) {
            if (
              !item ||
              typeof item !== 'object' ||
              !('url' in item) ||
              typeof item.url !== 'string' ||
              !/^https:\/\/mintpaper\.co\.kr\/festivals\/\d+$/.test(item.url)
            )
              continue;
            await this.dataSource.query(
              `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
               SELECT 'discovery', $1::varchar, 'ticket-list', '{"seed":"mintpaper-detail"}', now() - interval '1 day'
               WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
              [item.url],
            );
          }
        }
        if (source.kind === 'discovery' && Array.isArray(parsed)) {
          for (const item of parsed.slice(0, 100) as unknown[]) {
            if (!item || typeof item !== 'object' || !('url' in item)) continue;
            const url = item.url;
            if (
              typeof url !== 'string' ||
              url === source.url ||
              (!/^https:\/\/ticket\.melon\.com\/performance\/index\.htm\?prodId=\d+$/.test(
                url,
              ) &&
                !/^https:\/\/ticket\.yes24\.com\/Perf\/\d+$/.test(url) &&
                !/^https:\/\/nol\.yanolja\.com\/ticket\/products\/\d+$/.test(
                  url,
                ))
            )
              continue;
            await this.dataSource.query(
              `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
               SELECT 'discovery', $1::varchar, 'ticket-list', '{"seed":"ticket-detail"}', now() - interval '1 day'
               WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
              [url],
            );
          }
        }
        const candidate = await this.proposalItems(source, parsed);
        if (candidate.items.length) {
          const proposal = await this.proposalsRepo.save(
            this.proposalsRepo.create({
              festivalId: source.festivalId,
              sourceId: source.id,
              runId: run.id,
              kind: candidate.kind,
              status: 'open',
              confidence: 1,
              items: candidate.items,
              evidence: {
                snapshotUrl: run.snapshotUrl,
                excerpt: plainText(response.body).slice(0, 500),
                imageUrls,
              },
            }),
          );
          run.proposalId = proposal.id;
          run.result = 'proposed';
        } else {
          run.result = 'nochange-parsed';
        }
        source.lastChangedAt = new Date();
      }
      source.consecutiveFailures = 0;
      source.status = 'ok';
    } catch (error) {
      run.result = 'failed';
      run.error =
        run.httpStatus && run.httpStatus !== 200
          ? `HTTP_${run.httpStatus}`
          : error instanceof Error &&
              error.message === '요청 시간이 초과되었습니다.'
            ? 'TIMEOUT'
            : phase;
      this.logger.warn(
        `크롤 처리 실패: source=${source.id}, run=${run.id}, code=${run.error}`,
      );
      source.consecutiveFailures += 1;
      if (source.consecutiveFailures >= 3) source.status = 'broken';
    } finally {
      run.finishedAt = new Date();
      source.lastRunAt = run.finishedAt;
      await this.runsRepo.save(run);
      // 실행 중 관리자가 URL/설정을 바꿨더라도 오래된 source 객체로 덮지 않는다.
      const updated = await this.dataSource.query<
        { consecutiveFailures: number }[]
      >(
        `UPDATE crawl_sources SET
        "lastRunAt" = $1, "lastChangedAt" = COALESCE($2, "lastChangedAt"),
        "status" = CASE WHEN "enabled" = false THEN 'disabled'
          WHEN $3::boolean AND "consecutiveFailures" >= 2 THEN 'broken' ELSE 'ok' END,
        "consecutiveFailures" = CASE WHEN $3::boolean THEN "consecutiveFailures" + 1 ELSE 0 END,
        "updatedAt" = now() WHERE "id" = $4 RETURNING "consecutiveFailures"`,
        [
          source.lastRunAt,
          source.lastChangedAt,
          run.result === 'failed',
          source.id,
        ],
      );
      if (
        run.result === 'failed' &&
        Number(updated[0]?.consecutiveFailures) === 3
      ) {
        await this.alerts.recordThresholdFailure(
          source.id,
          run.id,
          run.error ?? '수집 실패',
        );
      }
    }
  }

  private async proposalItems(
    source: CrawlSource,
    parsed: unknown,
  ): Promise<{
    kind: Proposal['kind'];
    items: ProposalItem[];
  }> {
    const item = (
      id: string,
      op: ProposalItem['op'],
      path: string,
      before: unknown,
      after: unknown,
    ): ProposalItem => ({
      id,
      op,
      path,
      before,
      after,
      decision: 'pending',
      decidedBy: null,
      decidedAt: null,
    });
    if (source.kind === 'discovery' && Array.isArray(parsed)) {
      const known = await this.dataSource.query<
        { url: string | null; value: unknown }[]
      >(
        `SELECT item->'after'->>'url' AS url, item->'after' AS value
         FROM crawl_proposals, jsonb_array_elements(items) item
         WHERE "sourceId" = $1 AND kind = 'festival.new'
           AND status IN ('open', 'partial')
           AND item->>'decision' = 'pending'
         UNION ALL
         SELECT draft->'source'->>'url' AS url, NULL::jsonb AS value FROM admin_festivals
         WHERE draft->'source'->>'url' IS NOT NULL`,
        [source.id],
      );
      return {
        kind: 'festival.new',
        items: parsed.flatMap((entry, index) => {
          const url =
            entry && typeof entry === 'object'
              ? (entry as Record<string, unknown>).url
              : null;
          const duplicate = known.some(
            (row) =>
              row.url === url &&
              (row.value === null || isDeepStrictEqual(row.value, entry)),
          );
          return typeof url === 'string' && !duplicate
            ? [item(String(index), 'add', '/', null, entry)]
            : [];
        }),
      };
    }
    if (source.kind === 'notice' && typeof parsed === 'string') {
      return {
        kind: 'notice.new',
        items: [item('notice', 'add', '/', null, parsed)],
      };
    }
    const festival = source.festivalId
      ? await this.dataSource
          .getRepository(AdminFestival)
          .findOneBy({ id: source.festivalId })
      : null;
    if (!festival) throw new Error('페스티벌 초안을 찾을 수 없습니다.');
    if (source.kind === 'directions' && typeof parsed === 'string') {
      const directions = festival.draft.directions as Record<string, unknown>;
      const before = directions?.memo ?? null;
      return {
        kind: 'directions.diff',
        items:
          before === parsed
            ? []
            : [item('memo', 'update', '/directions/memo', before, parsed)],
      };
    }
    if (source.kind === 'days' && parsed && typeof parsed === 'object') {
      const value = parsed as {
        date: string;
        startsAt: string;
        endsAt: string;
      };
      const days = festival.draft.days as Record<string, unknown>[];
      const index = days.findIndex((day) => day.date === value.date);
      if (index < 0) throw new Error('초안에서 해당 날짜를 찾을 수 없습니다.');
      const after = {
        ...days[index],
        startsAt: value.startsAt,
        endsAt: value.endsAt,
      };
      return {
        kind: 'days.diff',
        items:
          JSON.stringify(days[index]) === JSON.stringify(after)
            ? []
            : [
                item(
                  value.date,
                  'update',
                  `/days/${index}`,
                  days[index],
                  after,
                ),
              ],
      };
    }
    if (source.kind === 'timetable' && Array.isArray(parsed)) {
      const sets = festival.draft.sets as Record<string, unknown>[];
      const parsedIds = new Set(
        parsed.map((entry: Record<string, unknown>) => entry.id),
      );
      const items = parsed.flatMap((entry: Record<string, unknown>) => {
        const index = sets.findIndex((set) => set.id === entry.id);
        const before = index < 0 ? null : sets[index];
        if (
          before &&
          before.crawlSourceId !== undefined &&
          before.crawlSourceId !== source.id
        )
          throw new Error('다른 크롤 소스의 공연 ID와 충돌합니다.');
        const next = { ...entry, crawlSourceId: source.id };
        if (JSON.stringify(before) === JSON.stringify(next)) return [];
        return [
          item(
            String(entry.id),
            index < 0 ? 'add' : 'update',
            index < 0 ? '/sets/-' : `/sets/${index}`,
            before,
            next,
          ),
        ];
      });
      for (const [index, set] of sets.entries()) {
        if (set.crawlSourceId !== source.id || parsedIds.has(set.id)) continue;
        items.push(item(String(set.id), 'remove', `/sets/${index}`, set, null));
      }
      return { kind: 'sets.diff', items };
    }
    throw new Error('소스 종류와 파서 결과가 맞지 않습니다.');
  }

  private async checkRobots(raw: string) {
    let url: URL;
    try {
      url = checkedUrl(raw);
    } catch (error) {
      throw new UnprocessableEntityException(String(error));
    }
    const robotsUrl = new URL('/robots.txt', url);
    const robots = await this.limitedGet(robotsUrl);
    // RFC 9309 treats 4xx robots.txt responses as unavailable: crawling may
    // continue. Network errors and 5xx remain fail-closed.
    if (robots.status >= 400 && robots.status < 500) return;
    if (robots.status !== 200) {
      throw new UnprocessableEntityException('robots.txt 확인에 실패했습니다.');
    }
    if (!robotsAllows(robots.body, `${url.pathname}${url.search}`)) {
      throw new UnprocessableEntityException({
        code: 'ROBOTS_DISALLOW',
        message: 'robots.txt가 수집을 금지합니다.',
      });
    }
  }

  private async limitedGet(url: URL) {
    return this.withHostLock(url, () => safeGet(url));
  }

  private async getListing(source: CrawlSource) {
    const response = await this.limitedGet(checkedUrl(source.url));
    if (response.status !== 200) return response;
    const count = yes24PageCount(source.url, response.body);
    if (count === 1) return response;
    const pages = [response.body];
    for (let page = 2; page <= count; page++) {
      const url = checkedUrl(source.url);
      url.searchParams.set('pCurPage', String(page));
      await this.checkRobots(url.toString());
      const next = await this.limitedGet(url);
      if (next.status !== 200)
        throw new Error(`YES24 목록 ${page}페이지 HTTP ${next.status}`);
      pages.push(next.body);
    }
    return { status: response.status, body: pages.join('\n') };
  }

  private async limitedGetImage(url: URL) {
    return this.withHostLock(url, () => safeGetImage(url));
  }

  private async withHostLock<T>(
    url: URL,
    request: () => Promise<T>,
  ): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('SELECT pg_advisory_lock(1792500003, hashtext($1))', [
        url.hostname,
      ]);
      try {
        return await request();
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await runner.query(
          'SELECT pg_advisory_unlock(1792500003, hashtext($1))',
          [url.hostname],
        );
      }
    } finally {
      await runner.release();
    }
  }

  private async captureImages(
    source: CrawlSource,
    run: CrawlRun,
    urls: URL[],
  ): Promise<string[]> {
    const stored: string[] = [];
    for (const url of selectRunImages(
      urls,
      source.url,
      run.scheduledDate ?? new Date().toISOString().slice(0, 10),
    )) {
      if (url.toString().length > 2048) continue;
      let validated = false;
      try {
        await this.checkRobots(url.toString());
        const response = await this.limitedGetImage(url);
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        const prepared = await prepareCrawlImage(
          response.body,
          response.contentType,
        );
        validated = true;
        const urlHash = createHash('sha256')
          .update(url.toString())
          .digest('hex');
        let image = await this.imageRepo.findOneBy({
          sourceId: source.id,
          urlHash,
          contentHash: prepared.hash,
        });
        if (!image) {
          await this.imageStorage.saveCrawlImage(
            prepared.key,
            prepared.body,
            'image/webp',
          );
          await this.imageRepo
            .createQueryBuilder()
            .insert()
            .values({
              sourceId: source.id,
              runId: run.id,
              originUrl: url.toString(),
              urlHash,
              contentHash: prepared.hash,
              objectKey: prepared.key,
            })
            .orIgnore()
            .execute();
          image = await this.imageRepo.findOneByOrFail({
            sourceId: source.id,
            urlHash,
            contentHash: prepared.hash,
          });
        } else {
          image.runId = run.id;
          image.lastSeenAt = new Date();
          await this.imageRepo.save(image);
        }
        stored.push(`/api/v1/admin/crawl/images/${image.id}`);
      } catch (error) {
        if (validated) throw error;
        this.logger.warn('크롤 이미지를 건너뛰었습니다.');
      }
    }
    return stored;
  }

  private async getSource(id: string) {
    const source = await this.sourcesRepo.findOneBy({ id });
    if (!source) throw new NotFoundException('크롤 소스를 찾을 수 없습니다.');
    return source;
  }
}
