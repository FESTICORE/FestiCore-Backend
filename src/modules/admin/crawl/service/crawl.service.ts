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
import {
  checkedUrl,
  robotsAllows,
  safeGet,
  safeGetBytes,
  safeGetImage,
} from './crawl-fetch';
import {
  artistProfileImageUrl,
  discoverImageUrls,
  prepareCrawlImage,
  selectRunImages,
} from './crawl-image';
import { parseCrawl, plainText, xmfNoticeArtistAliases } from './crawl-parser';
import { CrawlAlertService } from './crawl-alert.service';
import { CrawlTimetableRevisionService } from './crawl-timetable-revision.service';
import { extractTimetableImageCandidates } from './timetable-image-ocr';
import { crawlArtistGallery } from './artist-gallery';
import { timetableSourceConfig } from './timetable-source-config';
import {
  collectNolWorldLineupEvidence,
  MAX_NOL_LINEUP_IMAGE_BYTES,
} from './nol-world-lineup-evidence';
import { normalizeArtistName } from '../../../../common/artist-name';
import { PRUGIO_LINEUP_SEED, PRUGIO_LINEUP_URL } from './prugio-lineup';
import {
  parseWonderlivetBundleLineup,
  wonderlivetBundleUrl,
  WONDERLIVET_FESTIVAL_URL,
  WONDERLIVET_LINEUP_URL,
} from './wonderlivet-lineup';
import {
  WONDERLIVET_DETAIL_SEED,
  WONDERLIVET_LINK_PAGE,
  WONDERLIVET_TICKET_SEED,
} from './wonderlivet-ticket-link';
import {
  GMF_FESTIVAL_URL,
  GMF_LINEUP_URL,
  GMF_NOTICE_URL,
  parseGmfLineup,
} from './gmf-lineup';
import {
  CDF_PROFILE_SEED,
  cdfProfileFor,
  cdfProfileImageUrl,
} from './cdf-profile';
import {
  DRDR_PROFILE_SEED,
  drdrProfileFor,
  drdrProfileImageUrl,
} from './drdr-profile';
import {
  WONDERLIVET_PROFILE_SEED,
  wonderlivetProfileFor,
  wonderlivetProfileImageUrl,
} from './wonderlivet-profile';
import {
  FESTIVAL_PROFILE_SEED,
  festivalProfileFor,
  festivalProfileImageUrl,
} from './festival-profile';
import {
  ADDITIONAL_FESTIVAL_PROFILE_SEED,
  additionalFestivalProfileFor,
  additionalFestivalProfileImageUrl,
} from './additional-festival-profile';
import {
  CDF_LOW_HIGH_LOW_PROFILE_SEED,
  cdfLowHighLowProfileFor,
  cdfLowHighLowProfileImageUrl,
} from './cdf-low-high-low-profile';
import {
  PRUGIO_PROFILE_SEED,
  prugioProfileFor,
  prugioProfileImageUrl,
} from './prugio-profile';

const kstDay = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

const YES24_PAGE_LIMIT = 4;

function artistImageConfig(url: string, config: Record<string, string>) {
  const { artistName, artistAlias, festivalSourceUrl, imageHint } = config;
  if (config.seed === CDF_LOW_HIGH_LOW_PROFILE_SEED) {
    if (
      !cdfLowHighLowProfileFor(url, config) ||
      Object.keys(config).some(
        (key) =>
          !['seed', 'festivalSourceUrl', 'artistName', 'artistAlias'].includes(
            key,
          ),
      )
    )
      throw new UnprocessableEntityException(
        '검증된 CDF 로우하이로우 공식 프로필 소스 설정이 필요합니다.',
      );
    return { ...config };
  }
  if (config.seed === PRUGIO_PROFILE_SEED) {
    if (
      !prugioProfileFor(url, config) ||
      Object.keys(config).some(
        (key) => !['seed', 'festivalSourceUrl', 'artistName'].includes(key),
      )
    )
      throw new UnprocessableEntityException(
        '검증된 푸르지오 공식 프로필 소스 설정이 필요합니다.',
      );
    return { ...config };
  }
  if (config.seed === ADDITIONAL_FESTIVAL_PROFILE_SEED) {
    if (
      !additionalFestivalProfileFor(url, config) ||
      Object.keys(config).some(
        (key) => !['seed', 'festivalSourceUrl', 'artistName'].includes(key),
      )
    )
      throw new UnprocessableEntityException(
        '검증된 추가 공식 프로필 소스 설정이 필요합니다.',
      );
    return { ...config };
  }
  if (config.seed === FESTIVAL_PROFILE_SEED) {
    if (
      !festivalProfileFor(url, config) ||
      Object.keys(config).some(
        (key) => !['seed', 'festivalSourceUrl', 'artistName'].includes(key),
      )
    )
      throw new UnprocessableEntityException(
        '검증된 축제 공식 프로필 소스 설정이 필요합니다.',
      );
    return { ...config };
  }
  if (config.seed === WONDERLIVET_PROFILE_SEED) {
    if (
      !wonderlivetProfileFor(url, config) ||
      Object.keys(config).some(
        (key) => !['seed', 'festivalSourceUrl', 'artistName'].includes(key),
      )
    )
      throw new UnprocessableEntityException(
        '검증된 원더리벳 공식 프로필 소스 설정이 필요합니다.',
      );
    return { ...config };
  }
  if (config.seed === DRDR_PROFILE_SEED) {
    if (
      !drdrProfileFor(url, config) ||
      Object.keys(config).some(
        (key) => !['seed', 'festivalSourceUrl', 'artistName'].includes(key),
      )
    )
      throw new UnprocessableEntityException(
        '검증된 DRDR 공식 프로필 소스 설정이 필요합니다.',
      );
    return { ...config };
  }
  if (config.seed === CDF_PROFILE_SEED) {
    if (
      !cdfProfileFor(url, config) ||
      Object.keys(config).some(
        (key) =>
          ![
            'seed',
            'festivalSourceUrl',
            'artistName',
            'officialHandle',
            'artistAlias',
          ].includes(key),
      ) ||
      (artistAlias !== undefined &&
        (typeof artistAlias !== 'string' ||
          !artistAlias.trim() ||
          artistAlias.length > 160))
    )
      throw new UnprocessableEntityException(
        '검증된 CDF 공식 프로필 소스 설정이 필요합니다.',
      );
    return {
      ...config,
      ...(artistAlias === undefined ? {} : { artistAlias: artistAlias.trim() }),
    };
  }
  let festival: URL;
  try {
    festival = checkedUrl(festivalSourceUrl ?? '');
  } catch {
    throw new UnprocessableEntityException(
      '유효한 festivalSourceUrl이 필요합니다.',
    );
  }
  const officialWonderlivet =
    config.seed === 'official-wonderlivet-lineup' &&
    festival.toString() === WONDERLIVET_FESTIVAL_URL &&
    /^\/lineup\/artists\/production\/live\/day[123]\/[a-z0-9-]{1,110}\.webp$/.test(
      imageHint ?? '',
    );
  const officialGmf =
    config.seed === 'official-gmf-lineup' &&
    festival.toString() === GMF_FESTIVAL_URL &&
    /^\/GMF_2026_[a-zA-Z0-9_]+\.jpe?g$/.test(imageHint ?? '');
  if (
    (config.seed === 'official-gmf-lineup' && !officialGmf) ||
    (!officialWonderlivet &&
      ![
        'ticket.melon.com',
        'ticket.yes24.com',
        'nol.yanolja.com',
        'mintpaper.co.kr',
      ].includes(festival.hostname)) ||
    !artistName?.trim() ||
    artistName.length > 160 ||
    !imageHint?.trim() ||
    imageHint.length < 8 ||
    imageHint.length > (officialWonderlivet || officialGmf ? 180 : 120) ||
    /[\s<>"']/.test(imageHint) ||
    (artistAlias !== undefined &&
      (typeof artistAlias !== 'string' ||
        !artistAlias.trim() ||
        artistAlias.length > 160))
  )
    throw new UnprocessableEntityException(
      'artistName, festivalSourceUrl, imageHint가 필요합니다.',
    );
  const reviewedConfig = { ...config };
  delete reviewedConfig.artistAliasSource;
  return {
    ...reviewedConfig,
    artistName: artistName.trim(),
    ...(artistAlias === undefined ? {} : { artistAlias: artistAlias.trim() }),
    festivalSourceUrl: festival.toString(),
    imageHint,
  };
}

function artistGalleryConfig(url: string, config: Record<string, string>) {
  let source: URL;
  let festival: URL;
  try {
    source = checkedUrl(url);
    festival = checkedUrl(config.festivalSourceUrl ?? '');
  } catch {
    throw new UnprocessableEntityException(
      '유효한 공식 갤러리 URL과 festivalSourceUrl이 필요합니다.',
    );
  }
  if (!(
    (source.hostname === 'xmfestival.com' &&
      source.pathname === '/lineup' &&
      festival.toString() ===
        'https://ticket.melon.com/performance/index.htm?prodId=213766') ||
    (source.toString() === WONDERLIVET_LINEUP_URL &&
      festival.toString() === WONDERLIVET_FESTIVAL_URL) ||
    (source.toString() === GMF_LINEUP_URL &&
      festival.toString() === GMF_FESTIVAL_URL)
  ))
    throw new UnprocessableEntityException(
      '지원되는 공식 갤러리와 축제 연결 주소가 필요합니다.',
    );
  return { ...config, festivalSourceUrl: festival.toString() };
}

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
  private gmfImageQueue: Promise<void> = Promise.resolve();
  private readonly gmfQueuedSources = new Set<string>();

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
    private readonly timetableRevisions: CrawlTimetableRevisionService,
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
    void this.reconcileRecentXmf403().catch(() =>
      this.logger.warn('XMF 공식 출연진 별칭 시작 시 복구 실패'),
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
    if (
      dto.kind === 'artist-image' &&
      (dto.parserConfig.seed === 'official-artist-gallery' ||
        [
          'officialSiteKeys',
          'artistOfficialName',
          'artistOfficialNameSource',
        ].some((key) => Object.hasOwn(dto.parserConfig, key)))
    )
      throw new UnprocessableEntityException(
        '공식 갤러리 신원 정보는 수집 결과로만 등록할 수 있습니다.',
      );
    const parsers: Record<CrawlSource['kind'], CrawlSource['parser']> = {
      discovery: 'ticket-list',
      'artist-gallery': 'html-text',
      'artist-image': 'html-text',
      timetable: 'html-table',
      notice: 'html-text',
      directions: 'html-text',
      days: 'regex-days',
    };
    const imageTimetable =
      dto.kind === 'timetable' && dto.parser === 'image-ocr';
    if (!imageTimetable && dto.parser !== parsers[dto.kind]) {
      throw new UnprocessableEntityException(
        '소스 종류와 파서가 맞지 않습니다.',
      );
    }
    if (
      !['discovery', 'artist-gallery', 'artist-image'].includes(dto.kind) &&
      !imageTimetable &&
      !dto.festivalId
    ) {
      throw new UnprocessableEntityException('festivalId가 필요합니다.');
    }
    if (
      (['discovery', 'artist-gallery', 'artist-image'].includes(dto.kind) ||
        imageTimetable) &&
      dto.festivalId
    ) {
      throw new UnprocessableEntityException(
        '발견·아티스트 사진·이미지 시간표 소스에는 festivalId를 지정할 수 없습니다.',
      );
    }
    const parserConfig =
      dto.kind === 'artist-image'
        ? artistImageConfig(dto.url, dto.parserConfig)
        : dto.kind === 'artist-gallery'
          ? artistGalleryConfig(dto.url, dto.parserConfig)
          : dto.parserConfig;
    if (imageTimetable) {
      try {
        timetableSourceConfig(parserConfig);
      } catch (error) {
        throw new UnprocessableEntityException(String(error));
      }
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
          parserConfig,
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
    const aliasOnly =
      source.kind === 'artist-image' &&
      dto.parserConfig !== undefined &&
      Object.keys(dto.parserConfig).length === 1 &&
      Object.hasOwn(dto.parserConfig, 'artistAlias');
    if (
      ((['artist-gallery', 'artist-image'].includes(source.kind) ||
        source.parser === 'image-ocr') &&
        dto.url !== undefined &&
        dto.url !== source.url) ||
      ((source.kind === 'artist-gallery' || source.parser === 'image-ocr') &&
        dto.parserConfig !== undefined) ||
      (source.kind === 'artist-image' &&
        dto.parserConfig !== undefined &&
        !aliasOnly)
    )
      throw new UnprocessableEntityException(
        '이미지 수집 소스의 원본 URL과 연결 정보는 변경할 수 없습니다. 새 소스를 등록하세요.',
      );
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
      const parserConfig: Record<string, string> | undefined =
        dto.parserConfig && locked.kind === 'artist-image'
          ? artistImageConfig(locked.url, {
              ...before.parserConfig,
              ...dto.parserConfig,
            })
          : dto.parserConfig;
      if (parserConfig) locked.parserConfig = parserConfig;
      if (
        dto.enabled !== undefined &&
        ['official-wonderlivet-lineup', 'official-gmf-lineup'].includes(
          locked.parserConfig.seed,
        )
      ) {
        locked.parserConfig = { ...locked.parserConfig };
        delete locked.parserConfig.disabledBy;
      }
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
    if (source.parser === 'image-ocr') {
      const config = timetableSourceConfig(source.parserConfig);
      const response = await this.limitedGetImage(checkedUrl(source.url));
      if (response.status !== 200)
        throw new UnprocessableEntityException(`HTTP ${response.status}`);
      const parsed = await extractTimetableImageCandidates(response.body, {
        date: config.date,
        columns: config.columns,
      });
      return {
        parsed,
        excerpt: `${config.date}: ${parsed.length}/${config.expectedRows}개 공연 후보`,
      };
    }
    const response = await this.getListing(source);
    if (response.status !== 200)
      throw new UnprocessableEntityException(`HTTP ${response.status}`);
    if (
      source.kind === 'artist-image' &&
      source.parserConfig.seed === PRUGIO_PROFILE_SEED
    ) {
      const image = prugioProfileImageUrl(
        response.body,
        source.url,
        source.parserConfig,
      );
      if (!image)
        throw new UnprocessableEntityException(
          '푸르지오 공식 프로필 이미지를 확인하지 못했습니다.',
        );
      await this.checkRobots(image.toString());
      return {
        parsed: {
          artistName: source.parserConfig.artistName,
          imageUrl: image.toString(),
        },
        excerpt: source.parserConfig.artistName,
      };
    }
    if (
      source.kind === 'artist-image' &&
      source.parserConfig.seed === CDF_LOW_HIGH_LOW_PROFILE_SEED
    ) {
      const image = cdfLowHighLowProfileImageUrl(
        response.body,
        source.url,
        source.parserConfig,
      );
      if (!image)
        throw new UnprocessableEntityException(
          '멜론티켓 공식 로우하이로우 프로필 이미지를 확인하지 못했습니다.',
        );
      await this.checkRobots(image.toString());
      return {
        parsed: {
          artistName: source.parserConfig.artistName,
          imageUrl: image.toString(),
        },
        excerpt: source.parserConfig.artistName,
      };
    }
    if (
      source.kind === 'artist-image' &&
      source.parserConfig.seed === ADDITIONAL_FESTIVAL_PROFILE_SEED
    ) {
      const image = additionalFestivalProfileImageUrl(
        response.body,
        source.url,
        source.parserConfig,
      );
      if (!image)
        throw new UnprocessableEntityException(
          '추가 공식 프로필 이미지를 확인하지 못했습니다.',
        );
      await this.checkRobots(image.toString());
      return {
        parsed: {
          artistName: source.parserConfig.artistName,
          imageUrl: image.toString(),
        },
        excerpt: source.parserConfig.artistName,
      };
    }
    if (
      source.kind === 'artist-image' &&
      source.parserConfig.seed === FESTIVAL_PROFILE_SEED
    ) {
      const image = festivalProfileImageUrl(
        response.body,
        source.url,
        source.parserConfig,
      );
      if (!image)
        throw new UnprocessableEntityException(
          '축제 공식 프로필 이미지를 확인하지 못했습니다.',
        );
      await this.checkRobots(image.toString());
      return {
        parsed: {
          artistName: source.parserConfig.artistName,
          imageUrl: image.toString(),
        },
        excerpt: source.parserConfig.artistName,
      };
    }
    if (
      source.kind === 'artist-image' &&
      source.parserConfig.seed === WONDERLIVET_PROFILE_SEED
    ) {
      const image = wonderlivetProfileImageUrl(
        response.body,
        source.url,
        source.parserConfig,
      );
      if (!image)
        throw new UnprocessableEntityException(
          '원더리벳 공식 프로필 이미지를 확인하지 못했습니다.',
        );
      await this.checkRobots(image.toString());
      return {
        parsed: {
          artistName: source.parserConfig.artistName,
          imageUrl: image.toString(),
        },
        excerpt: source.parserConfig.artistName,
      };
    }
    if (
      source.kind === 'artist-image' &&
      source.parserConfig.seed === CDF_PROFILE_SEED
    ) {
      const image = cdfProfileImageUrl(
        response.body,
        source.url,
        source.parserConfig,
      );
      if (!image)
        throw new UnprocessableEntityException(
          'CDF 공식 프로필 이미지를 확인하지 못했습니다.',
        );
      await this.checkRobots(image.toString());
      return {
        parsed: {
          artistName: source.parserConfig.artistName,
          imageUrl: image.toString(),
        },
        excerpt: source.parserConfig.artistName,
      };
    }
    if (
      source.kind === 'artist-image' &&
      source.parserConfig.seed === DRDR_PROFILE_SEED
    ) {
      const image = drdrProfileImageUrl(
        response.body,
        source.url,
        source.parserConfig,
      );
      if (!image)
        throw new UnprocessableEntityException(
          'DRDR 공식 프로필 이미지를 확인하지 못했습니다.',
        );
      await this.checkRobots(image.toString());
      return {
        parsed: {
          artistName: source.parserConfig.artistName,
          imageUrl: image.toString(),
        },
        excerpt: source.parserConfig.artistName,
      };
    }
    return {
      parsed:
        source.kind === 'artist-gallery'
          ? source.url === WONDERLIVET_LINEUP_URL
            ? parseWonderlivetBundleLineup(response.body)
            : source.url === GMF_LINEUP_URL
              ? parseGmfLineup(response.body, await this.gmfNotice(source))
              : await crawlArtistGallery(response.body, source.url)
          : await parseCrawl(source, response.body),
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
    // Official galleries refresh child image hints before the daily child runs.
    const order = (source: CrawlSource) =>
      ![GMF_LINEUP_URL, WONDERLIVET_LINEUP_URL].includes(source.url)
        ? 1
        : source.kind === 'artist-gallery'
          ? 0
          : source.kind === 'artist-image'
            ? 2
            : 1;
    sources.sort((left, right) => order(left) - order(right));
    const listedIds = new Set(sources.map((source) => source.id));
    let gmfGalleryFailed = false;
    let wonderlivetGalleryFailed = false;
    let wonderlivetBundle: { body: string; snapshotUrl: string } | null = null;
    for (const listedSource of sources) {
      if (
        ((gmfGalleryFailed && listedSource.url === GMF_LINEUP_URL) ||
          (wonderlivetGalleryFailed &&
            listedSource.url === WONDERLIVET_LINEUP_URL)) &&
        listedSource.kind === 'artist-image' &&
        ['official-gmf-lineup', 'official-wonderlivet-lineup'].includes(
          listedSource.parserConfig.seed,
        )
      )
        continue;
      const source =
        listedSource.kind === 'artist-image' &&
        [GMF_LINEUP_URL, WONDERLIVET_LINEUP_URL].includes(listedSource.url)
          ? await this.sourcesRepo.findOneBy({ id: listedSource.id })
          : listedSource;
      if (!source?.enabled || !['ok', 'broken'].includes(source.status))
        continue;
      const gmfImage =
        source.kind === 'artist-image' &&
        source.url === GMF_LINEUP_URL &&
        source.parserConfig.seed === 'official-gmf-lineup';
      // GMF 갤러리가 만든 사진 소스는 같은 날 이어서 수집한다.
      if (!gmfImage && kstDay(source.createdAt) >= date) continue;
      // 실패한 소스도 다음 날 재시도한다. 당일 수동 실행 직후에는 중복 시도하지 않는다.
      if (
        source.status === 'broken' &&
        source.lastRunAt &&
        kstDay(source.lastRunAt) >= date
      )
        continue;
      if (gmfImage) {
        if (this.gmfQueuedSources.has(source.id)) continue;
        this.gmfQueuedSources.add(source.id);
        this.gmfImageQueue = this.gmfImageQueue
          .then(() => this.executeDueGmfImage(source, date))
          .catch(() => this.logger.error('GMF 공식 사진 예약 크롤 실패'))
          .finally(() => {
            this.gmfQueuedSources.delete(source.id);
          });
        continue;
      }
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
      if (
        source.kind === 'artist-gallery' &&
        [GMF_LINEUP_URL, WONDERLIVET_LINEUP_URL].includes(source.url)
      ) {
        try {
          const verified = await this.execute(run, source);
          if (source.url === WONDERLIVET_LINEUP_URL)
            wonderlivetBundle = verified ?? null;
        } catch {
          this.logger.error('공식 갤러리 예약 크롤 실패');
        }
        const failed = run.result === 'failed';
        if (source.url === GMF_LINEUP_URL) gmfGalleryFailed = failed;
        else wonderlivetGalleryFailed = failed;
        if (!failed) {
          const newChildren = await this.sourcesRepo.findBy({
            kind: 'artist-image',
            url: source.url,
            enabled: true,
            status: In(['ok', 'broken']),
          });
          for (const child of newChildren) {
            if (listedIds.has(child.id)) continue;
            sources.push(child);
            listedIds.add(child.id);
          }
        }
      } else {
        void this.execute(
          run,
          source,
          source.kind === 'artist-image' &&
            source.url === WONDERLIVET_LINEUP_URL &&
            source.parserConfig.seed === 'official-wonderlivet-lineup'
            ? wonderlivetBundle
            : null,
        ).catch(() => this.logger.error('예약 크롤 실패'));
      }
    }
  }

  private async executeDueGmfImage(source: CrawlSource, date: string) {
    // 큐에서 기다리는 동안에는 실행 행을 만들지 않아 15분 중단 회수에 걸리지 않는다.
    const current = await this.sourcesRepo.findOneBy({ id: source.id });
    if (
      !current?.enabled ||
      !['ok', 'broken'].includes(current.status) ||
      current.kind !== 'artist-image' ||
      current.url !== GMF_LINEUP_URL ||
      current.parserConfig.seed !== 'official-gmf-lineup' ||
      (current.status === 'broken' &&
        current.lastRunAt &&
        kstDay(current.lastRunAt) >= date)
    )
      return;
    source = current;
    await this.failStaleManualRun(source.id);
    const insert = await this.runsRepo
      .createQueryBuilder()
      .insert()
      .values({ sourceId: source.id, scheduledDate: date })
      .orIgnore()
      .returning('*')
      .execute();
    let runId = insert.identifiers[0]?.id as string | undefined;
    if (!runId) {
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
    if (!runId && source.consecutiveFailures === 1) {
      // 첫 실패 기록을 보존하고 별도의 실행으로 한 번만 재시도한다.
      const failed = await this.runsRepo.findOneBy({
        sourceId: source.id,
        scheduledDate: date,
        result: 'failed',
        error: In(['PROCESS', 'IMAGE_FETCH', 'IMAGE_STORE']),
      });
      if (
        failed?.finishedAt &&
        failed.finishedAt.getTime() < Date.now() - 60_000
      ) {
        const retried = await this.runsRepo
          .createQueryBuilder()
          .insert()
          .values({ sourceId: source.id })
          .orIgnore()
          .returning('*')
          .execute();
        runId = retried.identifiers[0]?.id as string | undefined;
      }
    }
    if (!runId) return;
    const run = await this.runsRepo.findOneByOrFail({ id: runId });
    await this.execute(run, source);
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

  private async execute(
    run: CrawlRun,
    source: CrawlSource,
    verifiedWonderlivetBundle?: { body: string; snapshotUrl: string } | null,
  ): Promise<{ body: string; snapshotUrl: string } | void> {
    let phase =
      source.kind === 'artist-image' && source.url === GMF_LINEUP_URL
        ? 'GMF_VERIFY'
        : 'ROBOTS';
    try {
      const verifiedGmfImage =
        source.kind === 'artist-image' &&
        source.url === GMF_LINEUP_URL &&
        source.parserConfig.seed === 'official-gmf-lineup'
          ? await this.gmfVerifiedImage(source)
          : null;
      if (!verifiedGmfImage) await this.checkRobots(source.url);
      phase = 'FETCH';
      if (source.parser === 'image-ocr') {
        const config = timetableSourceConfig(source.parserConfig);
        const imageUrl = checkedUrl(source.url);
        const response = await this.limitedGetImage(imageUrl);
        run.httpStatus = response.status;
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        const parserHash = createHash('sha256')
          .update('timetable-image-ocr:v1')
          .update(JSON.stringify(config))
          .digest('hex');
        const imageHash = createHash('sha256')
          .update(response.body)
          .digest('hex');
        run.contentHash = createHash('sha256')
          .update(imageHash)
          .update(parserHash)
          .digest('hex');
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
          source.status = 'ok';
          return;
        }
        phase = 'IMAGE';
        const saved = await this.captureImages(
          source,
          run,
          [imageUrl],
          new Map([[imageUrl.toString(), response]]),
        );
        const imageId = /\/images\/([0-9a-f-]+)$/.exec(saved[0] ?? '')?.[1];
        if (!imageId)
          throw new Error('시간표 원본 이미지를 저장하지 못했습니다.');
        phase = 'OCR';
        const candidates = await extractTimetableImageCandidates(
          response.body,
          {
            date: config.date,
            columns: config.columns,
          },
        );
        if (!candidates.length || candidates.length > config.expectedRows)
          throw new Error(
            '공식 시간표의 OCR 후보 수가 허용 범위를 벗어났습니다.',
          );
        const stageNames = new Map(
          config.columns.map((column) => [column.stageId, column.stageName]),
        );
        const sets = candidates.map((candidate) => ({
          artist: candidate.artistText ?? '',
          date: config.date,
          stageName: stageNames.get(candidate.stageId) ?? '',
          startsAt: candidate.startsAt,
          endsAt: candidate.endsAt,
        }));
        const revision = await this.timetableRevisions.stageCandidate({
          sourceId: source.id,
          runId: run.id,
          festivalSourceUrl: config.festivalSourceUrl,
          sourceUrl: config.sourcePageUrl,
          imageId,
          contentHash: imageHash,
          parserHash,
          sets,
        });
        run.result = revision.runId === run.id ? 'proposed' : 'nochange-parsed';
        source.lastChangedAt = new Date();
        source.status = 'ok';
        return;
      }
      const reusedWonderlivetBundle =
        verifiedWonderlivetBundle &&
        source.kind === 'artist-image' &&
        source.url === WONDERLIVET_LINEUP_URL &&
        source.parserConfig.seed === 'official-wonderlivet-lineup'
          ? verifiedWonderlivetBundle
          : null;
      const response = reusedWonderlivetBundle
        ? { status: 200, body: reusedWonderlivetBundle.body }
        : verifiedGmfImage
          ? {
              status: 200,
              body: JSON.stringify({
                artistName: source.parserConfig.artistName,
                imageUrl: verifiedGmfImage.href,
              }),
            }
          : await this.getListing(source);
      run.httpStatus =
        verifiedGmfImage || reusedWonderlivetBundle ? null : response.status;
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
              : source.url === WONDERLIVET_LINK_PAGE
                ? 'ticket-list:v4'
                : source.url ===
                    'https://ticket.yes24.com/English/Genre/Concert'
                  ? 'ticket-list:v4'
                  : /^https:\/\/(?:www\.)?mintpaper\.co\.kr\/posts\/4819(?:[?#]|$)/.test(
                        source.url,
                      )
                    ? 'ticket-list:v4'
                    : /^https:\/\/ticket\.yes24\.com\/(?:English\/)?Perf\/\d+$/.test(
                          source.url,
                        )
                      ? 'ticket-list:v4'
                      : source.url.startsWith(
                            'https://ticket.melon.com/search/index.htm?',
                          )
                        ? 'ticket-list:v4'
                        : source.url.startsWith(
                              'https://nol.yanolja.com/ticket',
                            ) ||
                            source.url.startsWith('https://world.nol.com/en/')
                          ? 'ticket-list:v5'
                          : source.url === 'https://xmfestival.com/notice'
                            ? 'ticket-list:v4'
                            : 'ticket-list:v3'
            : '',
        )
        .digest('hex');
      if (reusedWonderlivetBundle) {
        run.snapshotUrl = reusedWonderlivetBundle.snapshotUrl;
      } else {
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
      }
      if (source.kind === 'artist-gallery') {
        phase = 'PARSE';
        const config = artistGalleryConfig(source.url, source.parserConfig);
        if (source.url === GMF_LINEUP_URL) {
          const entries = parseGmfLineup(
            response.body,
            await this.gmfNotice(source),
          );
          const rows = await this.dataSource.query<
            { id: string; artistName: string }[]
          >(
            `SELECT id, "parserConfig"->>'artistName' AS "artistName"
             FROM crawl_sources WHERE kind = 'artist-image' AND url = $1::text
               AND "parserConfig"->>'festivalSourceUrl' = $2::text
               AND "parserConfig"->>'seed' = 'official-gmf-lineup'`,
            [source.url, config.festivalSourceUrl],
          );
          const owners = new Map<string, { id: string; artistName: string }>();
          for (const row of rows) {
            const key = normalizeArtistName(row.artistName);
            if (owners.has(key))
              throw new Error('GMF 기존 출연진 이미지 소스가 중복됩니다.');
            owners.set(key, row);
          }
          const seenIds: string[] = [];
          for (const entry of entries) {
            const imageHint = entry.imageUrl.pathname;
            const existing = owners.get(normalizeArtistName(entry.artistName));
            if (existing) {
              seenIds.push(existing.id);
              await this.dataSource.query(
                `UPDATE crawl_sources SET
                   "parserConfig" = ("parserConfig" - 'disabledBy') ||
                     jsonb_build_object('artistName', $2::text, 'imageHint', $3::text,
                       'previousImageHint', COALESCE("parserConfig"->>'previousImageHint',
                         "parserConfig"->>'imageHint')),
                   enabled = CASE WHEN "parserConfig"->>'disabledBy' = 'official-lineup'
                     THEN true ELSE enabled END,
                   status = CASE WHEN "parserConfig"->>'disabledBy' = 'official-lineup'
                     THEN 'ok' ELSE status END,
                   "updatedAt" = now()
                 WHERE id = $1::uuid AND kind = 'artist-image'
                   AND url = $4::text
                   AND "parserConfig"->>'seed' = 'official-gmf-lineup'`,
                [existing.id, entry.artistName, imageHint, source.url],
              );
              continue;
            }
            await this.dataSource.query(
              `INSERT INTO crawl_sources (kind, url, parser, "parserConfig", "createdAt")
               SELECT 'artist-image', $1::text, 'html-text',
                 jsonb_build_object('seed', 'official-gmf-lineup',
                   'festivalSourceUrl', $2::text, 'artistName', $3::text,
                   'imageHint', $4::text), now() - interval '1 day'
               WHERE NOT EXISTS (
                 SELECT 1 FROM crawl_sources WHERE kind = 'artist-image' AND url = $1::text
                   AND "parserConfig"->>'festivalSourceUrl' = $2::text
                   AND "parserConfig"->>'artistName' = $3::text
               )`,
              [
                source.url,
                config.festivalSourceUrl,
                entry.artistName,
                imageHint,
              ],
            );
          }
          await this.dataSource.query(
            `UPDATE crawl_sources SET enabled = false, status = 'disabled',
               "parserConfig" = "parserConfig" || jsonb_build_object('disabledBy', 'official-lineup'),
               "updatedAt" = now()
             WHERE kind = 'artist-image' AND url = $1::text
               AND "parserConfig"->>'festivalSourceUrl' = $2::text
               AND "parserConfig"->>'seed' = 'official-gmf-lineup'
               AND enabled = true AND id = ANY($4::uuid[])
               AND NOT (id = ANY($3::uuid[]))`,
            [
              source.url,
              config.festivalSourceUrl,
              seenIds,
              rows.map((row) => row.id),
            ],
          );
          await this.dataSource.query(
            `UPDATE crawl_sources SET "parserConfig" = "parserConfig" ||
               jsonb_build_object('verifiedDate', $2::text,
                 'verifiedRunId', $3::text, 'verifiedEntries', $4::text),
               "updatedAt" = now()
             WHERE id = $1::uuid AND kind = 'artist-gallery'
               AND url = $5::text
               AND "parserConfig"->>'seed' = 'gmf-official-lineup'`,
            [
              source.id,
              kstDay(),
              run.id,
              JSON.stringify(
                entries.map((entry) => ({
                  artistName: entry.artistName,
                  imageUrl: entry.imageUrl.href,
                })),
              ),
              source.url,
            ],
          );
          run.result = 'nochange-parsed';
          source.lastChangedAt = new Date();
          source.status = 'ok';
          return;
        }
        if (source.url === WONDERLIVET_LINEUP_URL) {
          const entries = parseWonderlivetBundleLineup(response.body);
          const rows = await this.dataSource.query<
            { id: string; artistName: string }[]
          >(
            `SELECT id, "parserConfig"->>'artistName' AS "artistName"
             FROM crawl_sources WHERE kind = 'artist-image' AND url = $1::text
               AND "parserConfig"->>'festivalSourceUrl' = $2::text
               AND "parserConfig"->>'seed' = 'official-wonderlivet-lineup'`,
            [source.url, config.festivalSourceUrl],
          );
          const owners = new Map<string, { id: string; artistName: string }>();
          for (const row of rows) {
            const key = normalizeArtistName(row.artistName);
            if (owners.has(key))
              throw new Error('공식 라인업의 기존 출연진 소스가 중복됩니다.');
            owners.set(key, row);
          }
          const seenIds: string[] = [];
          for (const entry of entries) {
            const imageHint = entry.imageUrl.pathname;
            const existing = owners.get(normalizeArtistName(entry.artistName));
            if (existing) {
              seenIds.push(existing.id);
              await this.dataSource.query(
                `UPDATE crawl_sources SET
                   "parserConfig" = ("parserConfig" - 'disabledBy') ||
                     jsonb_build_object('artistName', $2::text, 'imageHint', $3::text,
                       'previousImageHint', COALESCE("parserConfig"->>'previousImageHint',
                         "parserConfig"->>'imageHint')),
                   enabled = CASE WHEN "parserConfig"->>'disabledBy' = 'official-lineup'
                     THEN true ELSE enabled END,
                   status = CASE WHEN "parserConfig"->>'disabledBy' = 'official-lineup'
                     THEN 'ok' ELSE status END,
                   "updatedAt" = now()
                 WHERE id = $1::uuid AND kind = 'artist-image'
                   AND url = $4::text
                   AND "parserConfig"->>'seed' = 'official-wonderlivet-lineup'`,
                [existing.id, entry.artistName, imageHint, source.url],
              );
              continue;
            }
            await this.dataSource.query(
              `INSERT INTO crawl_sources (kind, url, parser, "parserConfig", "createdAt")
               SELECT 'artist-image', $1::text, 'html-text',
                 jsonb_build_object('seed', 'official-wonderlivet-lineup',
                   'festivalSourceUrl', $2::text, 'artistName', $3::text,
                   'imageHint', $4::text), now() - interval '1 day'
               WHERE NOT EXISTS (
                 SELECT 1 FROM crawl_sources WHERE kind = 'artist-image' AND url = $1::text
                   AND "parserConfig"->>'festivalSourceUrl' = $2::text
                   AND "parserConfig"->>'artistName' = $3::text
               )`,
              [
                source.url,
                config.festivalSourceUrl,
                entry.artistName,
                imageHint,
              ],
            );
          }
          await this.dataSource.query(
            `UPDATE crawl_sources SET enabled = false, status = 'disabled',
               "parserConfig" = "parserConfig" || jsonb_build_object('disabledBy', 'official-lineup'),
               "updatedAt" = now()
             WHERE kind = 'artist-image' AND url = $1::text
               AND "parserConfig"->>'festivalSourceUrl' = $2::text
               AND "parserConfig"->>'seed' = 'official-wonderlivet-lineup'
               AND enabled = true AND id = ANY($4::uuid[])
               AND NOT (id = ANY($3::uuid[]))`,
            [
              source.url,
              config.festivalSourceUrl,
              seenIds,
              rows.map((row) => row.id),
            ],
          );
          run.result = 'nochange-parsed';
          source.lastChangedAt = new Date();
          source.status = 'ok';
          return { body: response.body, snapshotUrl: run.snapshotUrl };
        }
        const officialTicketLink = [
          ...response.body.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi),
        ].some((link) => {
          try {
            return (
              checkedUrl(link[1].replace(/&amp;/gi, '&')).toString() ===
              config.festivalSourceUrl
            );
          } catch {
            return false;
          }
        });
        if (!officialTicketLink)
          throw new Error('공식 갤러리에서 연결된 공연을 확인하지 못했습니다.');
        await this.checkRobots('https://xmfestival.com/ajax/get_modal_menu.cm');
        const entries = await crawlArtistGallery(response.body, source.url);
        if (!entries.length)
          throw new Error('공식 출연진을 확인하지 못했습니다.');
        const names = new Set(entries.map((entry) => entry.artistName));
        if (names.size !== entries.length)
          throw new Error('공식 갤러리에 중복 출연진 이름이 있습니다.');
        run.contentHash = createHash('sha256')
          .update(JSON.stringify(entries))
          .digest('hex');
        for (const entry of entries) {
          const imageHint = entry.imageUrl.pathname.replace(
            /^\/thumbnail\//,
            '',
          );
          if (imageHint === entry.imageUrl.pathname)
            throw new Error('공식 이미지 경로가 올바르지 않습니다.');
          const updated = await this.dataSource.query<
            [{ id: string }[], number]
          >(
            `UPDATE crawl_sources SET
               "parserConfig" = "parserConfig" || jsonb_build_object(
                 'imageHint', $4::text, 'officialSiteKeys', $5::jsonb),
               enabled = true, status = 'ok', "updatedAt" = now()
             WHERE kind = 'artist-image' AND url = $1::text
               AND "parserConfig"->>'festivalSourceUrl' = $2::text
               AND "parserConfig"->>'artistName' = $3::text
               AND "parserConfig"->>'seed' = 'official-artist-gallery'
             RETURNING id`,
            [
              source.url,
              config.festivalSourceUrl,
              entry.artistName,
              imageHint,
              JSON.stringify(entry.officialSiteKeys),
            ],
          );
          if (updated[1] > 0) continue;
          await this.dataSource.query(
            `INSERT INTO crawl_sources (kind, url, parser, "parserConfig", "createdAt")
             SELECT 'artist-image', $1::text, 'html-text',
               jsonb_build_object('seed', 'official-artist-gallery',
                 'festivalSourceUrl', $2::text, 'artistName', $3::text,
                 'imageHint', $4::text, 'officialSiteKeys', $5::jsonb),
               now() - interval '1 day'
             WHERE NOT EXISTS (
               SELECT 1 FROM crawl_sources WHERE kind = 'artist-image' AND url = $1::text
                 AND "parserConfig"->>'festivalSourceUrl' = $2::text
                 AND "parserConfig"->>'artistName' = $3::text
             )`,
            [
              source.url,
              config.festivalSourceUrl,
              entry.artistName,
              imageHint,
              JSON.stringify(entry.officialSiteKeys),
            ],
          );
        }
        await this.dataSource.query(
          `UPDATE crawl_sources SET enabled = false, status = 'disabled',
             "updatedAt" = now()
           WHERE kind = 'artist-image' AND url = $1::text
             AND "parserConfig"->>'festivalSourceUrl' = $2::text
             AND "parserConfig"->>'seed' = 'official-artist-gallery'
             AND NOT ("parserConfig"->>'artistName' = ANY($3::text[]))`,
          [source.url, config.festivalSourceUrl, [...names]],
        );
        try {
          await this.syncXmfGalleryAliases(config.festivalSourceUrl);
        } catch (error) {
          this.logger.warn(
            `XMF 갤러리 사진을 저장했지만 공식 공지 별칭을 확인하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        run.result = 'nochange-parsed';
        source.lastChangedAt = new Date();
        source.status = 'ok';
        return;
      }
      const profileImage =
        source.kind === 'artist-image'
          ? source.parserConfig.seed === 'official-gmf-lineup' &&
            source.url === GMF_LINEUP_URL
            ? verifiedGmfImage
            : source.parserConfig.seed === PRUGIO_PROFILE_SEED
              ? prugioProfileImageUrl(
                  response.body,
                  source.url,
                  source.parserConfig,
                )
              : source.parserConfig.seed === CDF_LOW_HIGH_LOW_PROFILE_SEED
                ? cdfLowHighLowProfileImageUrl(
                    response.body,
                    source.url,
                    source.parserConfig,
                  )
                : source.parserConfig.seed === FESTIVAL_PROFILE_SEED
                  ? festivalProfileImageUrl(
                      response.body,
                      source.url,
                      source.parserConfig,
                    )
                  : source.parserConfig.seed ===
                      ADDITIONAL_FESTIVAL_PROFILE_SEED
                    ? additionalFestivalProfileImageUrl(
                        response.body,
                        source.url,
                        source.parserConfig,
                      )
                    : source.parserConfig.seed === WONDERLIVET_PROFILE_SEED
                      ? wonderlivetProfileImageUrl(
                          response.body,
                          source.url,
                          source.parserConfig,
                        )
                      : source.parserConfig.seed === CDF_PROFILE_SEED
                        ? cdfProfileImageUrl(
                            response.body,
                            source.url,
                            source.parserConfig,
                          )
                        : source.parserConfig.seed === DRDR_PROFILE_SEED
                          ? drdrProfileImageUrl(
                              response.body,
                              source.url,
                              source.parserConfig,
                            )
                          : source.parserConfig.seed ===
                                'official-wonderlivet-lineup' &&
                              source.url === WONDERLIVET_LINEUP_URL
                            ? (parseWonderlivetBundleLineup(response.body).find(
                                (entry) =>
                                  entry.artistName ===
                                    source.parserConfig.artistName &&
                                  entry.imageUrl.pathname ===
                                    source.parserConfig.imageHint,
                              )?.imageUrl ?? null)
                            : artistProfileImageUrl(
                                response.body,
                                source.url,
                                source.parserConfig.imageHint,
                              )
          : null;
      if (source.kind === 'artist-image' && !profileImage)
        throw new Error('프로필 이미지가 공식 페이지에서 확인되지 않았습니다.');
      if (source.kind === 'artist-image' && source.url === GMF_LINEUP_URL)
        phase = 'IMAGE';
      const imageUrls = await this.captureImages(
        source,
        run,
        source.kind === 'discovery' &&
          source.url === PRUGIO_LINEUP_URL &&
          source.parserConfig.seed === PRUGIO_LINEUP_SEED
          ? []
          : profileImage
            ? [profileImage]
            : discoverImageUrls(response.body, source.url),
      );
      if (source.kind === 'artist-image' && !imageUrls.length)
        throw new Error('프로필 이미지를 저장하지 못했습니다.');
      if (
        source.kind === 'artist-image' &&
        profileImage &&
        ['official-wonderlivet-lineup', 'official-gmf-lineup'].includes(
          source.parserConfig.seed,
        )
      )
        await this.dataSource.query(
          `UPDATE crawl_sources SET "parserConfig" = "parserConfig" - 'previousImageHint',
             "updatedAt" = now()
           WHERE id = $1::uuid AND kind = 'artist-image'
             AND "parserConfig"->>'seed' = $2::text
             AND "parserConfig"->>'imageHint' = $3::text`,
          [source.id, source.parserConfig.seed, profileImage.pathname],
        );
      const previous = await this.runsRepo
        .createQueryBuilder('run')
        .where(
          'run.sourceId = :sourceId AND run.id != :id AND run.result != :failed',
          { sourceId: source.id, id: run.id, failed: 'failed' },
        )
        .orderBy('run.startedAt', 'DESC')
        .getOne();
      if (
        source.kind === 'discovery' &&
        source.parser === 'ticket-list' &&
        /^https:\/\/world\.nol\.com\/en\/ticket\/products\/\d+$/.test(
          source.url,
        )
      ) {
        run.lineupEvidence = await collectNolWorldLineupEvidence(
          response.body,
          source.url,
          previous?.lineupEvidence ?? null,
          {
            checkRobots: (url) => this.checkRobots(url),
            getImage: (url) =>
              this.withHostLock(url, () =>
                safeGetBytes(
                  url,
                  'image/jpeg,image/png,image/webp',
                  MAX_NOL_LINEUP_IMAGE_BYTES,
                ),
              ),
          },
        );
      }
      await this.syncXmfArtistAliases(source, response.body);
      const officialTicketLinks =
        source.url === 'https://www.mintpaper.co.kr/posts/4821' ||
        source.url === WONDERLIVET_LINK_PAGE;
      let officialParsed: unknown = null;
      if (officialTicketLinks) {
        phase = 'PARSE';
        officialParsed = await parseCrawl(source, response.body);
        if (source.url === WONDERLIVET_LINK_PAGE)
          await this.reconcileWonderlivetTicketLink(
            source,
            officialParsed,
            run.id,
          );
        else await this.reconcileOfficialTicketLinks(source, officialParsed);
      }
      if (source.kind === 'artist-image') {
        run.result =
          previous?.contentHash === run.contentHash
            ? 'unchanged'
            : 'nochange-parsed';
        if (run.result !== 'unchanged') source.lastChangedAt = new Date();
      } else if (
        run.lineupEvidence &&
        previous?.contentHash === run.contentHash &&
        !isDeepStrictEqual(previous?.lineupEvidence ?? null, run.lineupEvidence)
      ) {
        // Changed private OCR evidence must not reopen a public festival proposal.
        run.result = 'nochange-parsed';
      } else if (
        previous?.contentHash === run.contentHash &&
        isDeepStrictEqual(
          previous?.lineupEvidence ?? null,
          run.lineupEvidence ?? null,
        ) &&
        !(
          source.kind === 'discovery' &&
          source.parser === 'ticket-list' &&
          source.parserConfig.seed === WONDERLIVET_DETAIL_SEED &&
          source.parserConfig.festivalSourceUrl === WONDERLIVET_FESTIVAL_URL
        )
      ) {
        run.result = 'unchanged';
      } else {
        phase = 'PARSE';
        const parsed =
          officialParsed ?? (await parseCrawl(source, response.body));
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
        if (
          !officialTicketLinks &&
          source.kind === 'discovery' &&
          Array.isArray(parsed)
        ) {
          for (const item of parsed.slice(0, 100) as unknown[]) {
            if (!item || typeof item !== 'object' || !('url' in item)) continue;
            const url = item.url;
            if (
              typeof url !== 'string' ||
              url === source.url ||
              (!/^https:\/\/ticket\.melon\.com\/performance\/index\.htm\?prodId=\d+$/.test(
                url,
              ) &&
                !/^https:\/\/ticket\.yes24\.com\/(?:English\/)?Perf\/\d+$/.test(
                  url,
                ) &&
                !/^https:\/\/(?:nol\.yanolja\.com\/ticket|world\.nol\.com\/en\/ticket)\/products\/\d+$/.test(
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
        const candidate = officialTicketLinks
          ? { kind: 'festival.new' as const, items: [] }
          : await this.proposalItems(source, parsed);
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
          if (
            source.parserConfig.seed === WONDERLIVET_DETAIL_SEED &&
            'matchedProposalId' in candidate
          )
            run.proposalId = candidate.matchedProposalId ?? null;
        }
        if (previous?.contentHash !== run.contentHash)
          source.lastChangedAt = new Date();
      }
      source.consecutiveFailures = 0;
      source.status = 'ok';
    } catch (error) {
      run.result = 'failed';
      run.error ??=
        run.httpStatus && run.httpStatus !== 200
          ? `HTTP_${run.httpStatus}`
          : error instanceof Error &&
              error.message === '요청 시간이 초과되었습니다.'
            ? 'TIMEOUT'
            : phase;
      this.logger.warn(
        `크롤 처리 실패: source=${source.id}, run=${run.id}, code=${run.error}`,
      );
      if (run.error === 'HTTP_403') {
        try {
          await this.syncXmfAliasesFromRecentSnapshot(source);
        } catch {
          this.logger.warn(
            `XMF 공식 공지 스냅샷 별칭 복구 실패: source=${source.id}`,
          );
        }
      }
      source.consecutiveFailures += 1;
      if (source.consecutiveFailures >= 3) source.status = 'broken';
    } finally {
      if (
        run.result !== 'failed' &&
        run.lineupEvidence?.some((entry) => entry.status === 'failed')
      )
        run.error = 'LINEUP_EVIDENCE_PARTIAL';
      run.finishedAt = new Date();
      source.lastRunAt = run.finishedAt;
      await this.runsRepo.save(run);
      // 실행 중 관리자가 URL/설정을 바꿨더라도 오래된 source 객체로 덮지 않는다.
      const updated = await this.dataSource.query<
        [{ consecutiveFailures: number }[], number]
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
        Number(updated[0]?.[0]?.consecutiveFailures) === 3
      ) {
        await this.alerts.recordThresholdFailure(
          source.id,
          run.id,
          run.error ?? '수집 실패',
        );
      }
    }
  }

  private async reconcileOfficialTicketLinks(
    source: CrawlSource,
    parsed: unknown,
  ): Promise<void> {
    if (source.kind !== 'discovery' || source.parser !== 'ticket-list')
      throw new Error('공식 예매 링크 소스 종류가 올바르지 않습니다.');
    if (source.parserConfig.seed !== 'official-ticket-links')
      throw new Error('공식 예매 링크 소스 설정이 올바르지 않습니다.');
    const festivalSourceUrl = source.parserConfig.festivalSourceUrl;
    if (festivalSourceUrl !== 'https://mintpaper.co.kr/festivals/178')
      throw new Error('공식 예매 링크의 축제 연결이 올바르지 않습니다.');
    if (!Array.isArray(parsed) || !parsed.length)
      throw new Error('공식 예매 링크를 찾지 못했습니다.');
    const urls = parsed.map((item: unknown) =>
      item && typeof item === 'object' && 'url' in item ? item.url : null,
    );
    if (
      urls.length > 5 ||
      urls.some(
        (url) =>
          typeof url !== 'string' ||
          !/^https:\/\/(?:nol\.yanolja\.com\/ticket\/products|ticket\.yes24\.com\/Perf)\/\d+$/.test(
            url,
          ),
      )
    )
      throw new Error('공식 예매 상품 링크가 올바르지 않습니다.');
    const detailConfig = JSON.stringify({
      seed: 'official-ticket-link-detail',
      festivalSourceUrl,
      festivalSourceUrls: [festivalSourceUrl],
    });
    await this.dataSource.transaction(async (manager) => {
      for (const url of urls as string[]) {
        await manager.query(
          `UPDATE crawl_sources SET "parserConfig" = "parserConfig" || $2::jsonb,
           "updatedAt" = now()
         WHERE "url" = $1 AND "kind" = 'discovery' AND "parser" = 'ticket-list'
           AND "parserConfig"->>'seed' = 'ticket-detail'
           AND (NOT ("parserConfig" ? 'festivalSourceUrl')
             OR "parserConfig"->>'festivalSourceUrl' = $3)
           AND NOT ("parserConfig" ? 'festivalSourceUrls')`,
          [url, detailConfig, festivalSourceUrl],
        );
        await manager.query(
          `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
         SELECT 'discovery', $1::varchar, 'ticket-list', $2::jsonb, now() - interval '1 day'
         WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
          [url, detailConfig],
        );
        const rows = await manager.query<
          { parserConfig: Record<string, unknown> }[]
        >(`SELECT "parserConfig" FROM crawl_sources WHERE "url" = $1 LIMIT 1`, [
          url,
        ]);
        if (
          rows[0]?.parserConfig.seed !== 'official-ticket-link-detail' ||
          rows[0]?.parserConfig.festivalSourceUrl !== festivalSourceUrl
        )
          throw new Error(`기존 예매처 크롤 소스 설정이 다릅니다: ${url}`);
      }
      const updated = await manager.query<[{ id: string }[], number]>(
        `UPDATE crawl_sources SET "parserConfig" = "parserConfig" ||
         jsonb_build_object('verifiedTicketUrls', $2::text), "updatedAt" = now()
       WHERE id = $1 AND "parserConfig"->>'seed' = 'official-ticket-links'
         AND "parserConfig"->>'festivalSourceUrl' = $3
       RETURNING id`,
        [source.id, JSON.stringify(urls), festivalSourceUrl],
      );
      if (
        updated[1] !== 1 ||
        updated[0]?.length !== 1 ||
        updated[0][0]?.id !== source.id
      )
        throw new Error('공식 예매 링크 부모 소스 설정이 변경되었습니다.');
    });
  }

  private async reconcileWonderlivetTicketLink(
    source: CrawlSource,
    parsed: unknown,
    runId: string,
  ): Promise<void> {
    if (
      source.kind !== 'discovery' ||
      source.parser !== 'ticket-list' ||
      source.url !== WONDERLIVET_LINK_PAGE ||
      source.parserConfig.seed !== WONDERLIVET_TICKET_SEED ||
      source.parserConfig.festivalSourceUrl !== WONDERLIVET_FESTIVAL_URL ||
      !Array.isArray(parsed) ||
      parsed.length !== 1
    )
      throw new Error('원더리벳 공식 링크 소스 설정이 올바르지 않습니다.');
    const candidate = parsed[0] as { name?: unknown; url?: unknown };
    if (
      candidate.name !== 'WONDERLIVET 2026' ||
      typeof candidate.url !== 'string' ||
      !/^https:\/\/ticket\.melon\.com\/performance\/index\.htm\?prodId=[1-9]\d*$/.test(
        candidate.url,
      )
    )
      throw new Error('원더리벳 공식 멜론 상품이 올바르지 않습니다.');
    const detailConfig = JSON.stringify({
      seed: WONDERLIVET_DETAIL_SEED,
      festivalSourceUrl: WONDERLIVET_FESTIVAL_URL,
      festivalSourceUrls: [candidate.url, WONDERLIVET_FESTIVAL_URL],
    });
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE crawl_sources SET "parserConfig" = "parserConfig" || $2::jsonb,
         "updatedAt" = now()
       WHERE url = $1::text AND kind = 'discovery' AND parser = 'ticket-list'
         AND "parserConfig"->>'seed' IN ('ticket-detail', $3::text)
         AND (NOT ("parserConfig" ? 'festivalSourceUrl')
           OR "parserConfig"->>'festivalSourceUrl' = $4::text)
         AND (NOT ("parserConfig" ? 'festivalSourceUrls')
           OR "parserConfig"->'festivalSourceUrls' IN (
             jsonb_build_array($4::text), jsonb_build_array($1::text, $4::text)))`,
        [
          candidate.url,
          detailConfig,
          WONDERLIVET_DETAIL_SEED,
          WONDERLIVET_FESTIVAL_URL,
        ],
      );
      await manager.query(
        `INSERT INTO crawl_sources (kind, url, parser, "parserConfig", "createdAt")
       SELECT 'discovery', $1::text, 'ticket-list', $2::jsonb, now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE url = $1::text)`,
        [candidate.url, detailConfig],
      );
      const children = await manager.query<
        { parserConfig: Record<string, unknown>; enabled: boolean }[]
      >(
        `SELECT "parserConfig", enabled FROM crawl_sources
       WHERE url = $1::text AND kind = 'discovery' AND parser = 'ticket-list'`,
        [candidate.url],
      );
      if (
        children.length !== 1 ||
        !children[0].enabled ||
        children[0].parserConfig.seed !== WONDERLIVET_DETAIL_SEED ||
        children[0].parserConfig.festivalSourceUrl !==
          WONDERLIVET_FESTIVAL_URL ||
        JSON.stringify(children[0].parserConfig.festivalSourceUrls) !==
          JSON.stringify([candidate.url, WONDERLIVET_FESTIVAL_URL])
      )
        throw new Error('멜론 상품 소스가 다른 축제에 연결되어 있습니다.');
      const updated = await manager.query<[{ id: string }[], number]>(
        `UPDATE crawl_sources SET "parserConfig" = "parserConfig" ||
         jsonb_build_object('verifiedTicketUrl', $2::text,
           'verifiedRunId', $6::text), "updatedAt" = now()
       WHERE id = $1::uuid AND url = $3::text AND enabled = true
         AND "parserConfig"->>'seed' = $4::text
         AND "parserConfig"->>'festivalSourceUrl' = $5::text
       RETURNING id`,
        [
          source.id,
          candidate.url,
          WONDERLIVET_LINK_PAGE,
          WONDERLIVET_TICKET_SEED,
          WONDERLIVET_FESTIVAL_URL,
          runId,
        ],
      );
      if (
        updated[1] !== 1 ||
        updated[0]?.length !== 1 ||
        updated[0][0]?.id !== source.id
      )
        throw new Error('공식 링크 부모 소스 설정이 변경되었습니다.');
    });
  }

  private async syncXmfArtistAliases(
    source: CrawlSource,
    body: string,
  ): Promise<void> {
    if (
      source.kind !== 'discovery' ||
      source.url !== 'https://xmfestival.com/notice' ||
      source.parserConfig.seed !== 'official-lineup' ||
      !/^20\d{2}$/.test(source.parserConfig.expectedYear ?? '')
    )
      return;
    const aliases = xmfNoticeArtistAliases(
      body,
      source.url,
      Number(source.parserConfig.expectedYear),
    );
    if (!aliases) return;
    const festivalSourceUrl = source.parserConfig.festivalSourceUrl;
    if (!festivalSourceUrl) return;
    const rows = await this.dataSource.query<
      {
        id: string;
        enabled: boolean;
        artistName: string;
        artistAlias: string | null;
        aliasSource: string | null;
        officialSiteKeys: string[] | null;
        artistOfficialName: string | null;
        officialNameSource: string | null;
        seed: string | null;
      }[]
    >(
      `SELECT id, enabled, "parserConfig"->>'artistName' AS "artistName",
         "parserConfig"->>'artistAlias' AS "artistAlias",
         "parserConfig"->>'artistAliasSource' AS "aliasSource",
         "parserConfig"->'officialSiteKeys' AS "officialSiteKeys",
         "parserConfig"->>'artistOfficialName' AS "artistOfficialName",
         "parserConfig"->>'artistOfficialNameSource' AS "officialNameSource",
         "parserConfig"->>'seed' AS seed
       FROM crawl_sources
       WHERE kind = 'artist-image'
         AND "parserConfig"->>'festivalSourceUrl' = $1::text`,
      [festivalSourceUrl],
    );
    const owners = new Map<string, Set<string>>();
    for (const row of rows) {
      for (const name of [
        row.artistName,
        row.aliasSource === 'official-notice' ? null : row.artistAlias,
      ]) {
        if (!name) continue;
        const key = normalizeArtistName(name);
        const ids = owners.get(key) ?? new Set<string>();
        ids.add(row.id);
        owners.set(key, ids);
      }
    }
    const targets = new Map<string, string>();
    const officialNames = new Map<string, string>();
    const proposedAliases = new Map<string, Set<string>>();
    const proposedNamesByRow = new Map<string, Set<string>>();
    for (const pair of aliases) {
      const english = owners.get(normalizeArtistName(pair.alias));
      const aliasKey = normalizeArtistName(pair.alias).replace(
        /[^a-z0-9]/g,
        '',
      );
      const siteMatches = rows.filter((entry) => {
        const nameKey = normalizeArtistName(entry.artistName).replace(
          /[^a-z0-9]/g,
          '',
        );
        return (
          nameKey.length >= 4 &&
          aliasKey.startsWith(nameKey) &&
          aliasKey !== nameKey &&
          Array.isArray(entry.officialSiteKeys) &&
          entry.officialSiteKeys.includes(aliasKey)
        );
      });
      const row =
        english?.size === 1
          ? rows.find((entry) => entry.id === [...english][0])
          : !english?.size && siteMatches.length === 1
            ? siteMatches[0]
            : null;
      if (
        !row?.enabled ||
        row.seed !== 'official-artist-gallery' ||
        (normalizeArtistName(row.artistName) !==
          normalizeArtistName(pair.alias) &&
          siteMatches[0]?.id !== row.id)
      )
        continue;
      const korean = owners.get(normalizeArtistName(pair.name));
      if (korean?.size && (korean.size !== 1 || !korean.has(row.id))) continue;
      const candidates =
        proposedAliases.get(normalizeArtistName(pair.name)) ??
        new Set<string>();
      candidates.add(row.id);
      proposedAliases.set(normalizeArtistName(pair.name), candidates);
      const names = proposedNamesByRow.get(row.id) ?? new Set<string>();
      names.add(normalizeArtistName(pair.name));
      proposedNamesByRow.set(row.id, names);
      targets.set(row.id, pair.name);
      if (siteMatches[0]?.id === row.id && !english?.size)
        officialNames.set(row.id, pair.alias);
    }
    for (const row of rows) {
      const proposed = targets.get(row.id) ?? null;
      const desired =
        proposed &&
        proposedAliases.get(normalizeArtistName(proposed))?.size === 1 &&
        proposedNamesByRow.get(row.id)?.size === 1
          ? proposed
          : null;
      const officialName = desired ? (officialNames.get(row.id) ?? null) : null;
      const updateOfficial =
        row.officialNameSource === 'official-notice-and-modal-site' ||
        (!row.artistOfficialName && !!officialName);
      const updateAlias =
        row.aliasSource === 'official-notice' ||
        (!row.artistAlias && !!desired);
      if (
        (!updateOfficial ||
          (row.artistOfficialName === officialName &&
            row.officialNameSource ===
              (officialName ? 'official-notice-and-modal-site' : null))) &&
        (!updateAlias ||
          (row.artistAlias === desired &&
            row.aliasSource === (desired ? 'official-notice' : null)))
      )
        continue;
      await this.dataSource.query(
        `UPDATE crawl_sources SET "parserConfig" =
           ("parserConfig"
             - CASE WHEN $5::boolean THEN ARRAY['artistOfficialName', 'artistOfficialNameSource'] ELSE ARRAY[]::text[] END
             - CASE WHEN $6::boolean THEN ARRAY['artistAlias', 'artistAliasSource'] ELSE ARRAY[]::text[] END)
           || CASE WHEN $5::boolean AND $2::text IS NOT NULL
             THEN jsonb_build_object('artistOfficialName', $2::text,
               'artistOfficialNameSource', 'official-notice-and-modal-site')
             ELSE '{}'::jsonb END
           || CASE WHEN $6::boolean AND $3::text IS NOT NULL
             THEN jsonb_build_object('artistAlias', $3::text,
               'artistAliasSource', 'official-notice')
             ELSE '{}'::jsonb END,
           "updatedAt" = now()
         WHERE id = $1::uuid AND kind = 'artist-image'
           AND "parserConfig"->>'festivalSourceUrl' = $4::text
           AND (NOT $5::boolean OR "parserConfig"->>'artistOfficialNameSource' =
             'official-notice-and-modal-site' OR NOT ("parserConfig" ? 'artistOfficialName'))
           AND (NOT $6::boolean OR "parserConfig"->>'artistAliasSource' =
             'official-notice' OR NOT ("parserConfig" ? 'artistAlias'))`,
        [
          row.id,
          officialName,
          desired,
          festivalSourceUrl,
          updateOfficial,
          updateAlias,
        ],
      );
    }
  }

  private async syncXmfGalleryAliases(festivalSourceUrl: string) {
    const notice = await this.sourcesRepo.findOneBy({
      kind: 'discovery',
      url: 'https://xmfestival.com/notice',
      enabled: true,
    });
    if (
      notice?.parserConfig.seed !== 'official-lineup' ||
      notice.parserConfig.festivalSourceUrl !== festivalSourceUrl ||
      !/^20\d{2}$/.test(notice.parserConfig.expectedYear ?? '')
    )
      return;
    await this.checkRobots(notice.url);
    const response = await this.getListing(notice);
    if (response.status !== 200)
      throw new Error(`XMF 공식 라인업 공지 HTTP ${response.status}`);
    await this.syncXmfArtistAliases(notice, response.body);
  }

  private async syncXmfAliasesFromRecentSnapshot(
    source: CrawlSource,
  ): Promise<void> {
    const notice =
      source.kind === 'discovery' &&
      source.url === 'https://xmfestival.com/notice'
        ? source
        : source.kind === 'artist-gallery' &&
            source.url === 'https://xmfestival.com/lineup'
          ? await this.sourcesRepo.findOneBy({
              kind: 'discovery',
              url: 'https://xmfestival.com/notice',
              enabled: true,
            })
          : null;
    if (
      !notice?.enabled ||
      notice.parserConfig.seed !== 'official-lineup' ||
      !/^20\d{2}$/.test(notice.parserConfig.expectedYear ?? '') ||
      notice.parserConfig.expectedYear !== kstDay().slice(0, 4) ||
      !notice.parserConfig.festivalSourceUrl ||
      (source.kind === 'artist-gallery' &&
        notice.parserConfig.festivalSourceUrl !==
          source.parserConfig.festivalSourceUrl)
    )
      return;
    if (
      source.kind === 'artist-gallery' &&
      source.parserConfig.seed === 'xmf-official-gallery'
    ) {
      try {
        await this.restoreXmfGalleryIdentityFromRecentSnapshot(source);
      } catch (error) {
        this.logger.warn(
          `XMF 공식 갤러리 신원 복구 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const snapshots = await this.dataSource.query<{ objectKey: string }[]>(
      `SELECT snapshot."objectKey" AS "objectKey"
       FROM crawl_snapshots snapshot
       JOIN crawl_runs previous ON previous.id = snapshot."runId"
       JOIN crawl_sources origin ON origin.id = previous."sourceId"
       WHERE previous."sourceId" = $1::uuid
         AND origin.kind = 'discovery' AND origin.url = $2::text
         AND origin.enabled = true
         AND origin."parserConfig"->>'seed' = 'official-lineup'
         AND origin."parserConfig"->>'expectedYear' = $3::text
         AND origin."parserConfig"->>'festivalSourceUrl' = $4::text
         AND previous."httpStatus" = 200
         AND previous.result IN ('nochange-parsed', 'proposed', 'unchanged')
         AND previous."finishedAt" >= now() - interval '7 days'
         AND snapshot."expiresAt" > now()
       ORDER BY previous."finishedAt" DESC LIMIT 1`,
      [
        notice.id,
        notice.url,
        notice.parserConfig.expectedYear,
        notice.parserConfig.festivalSourceUrl,
      ],
    );
    if (!snapshots[0]) return;
    const body = await this.imageStorage.readCrawlSnapshot(
      snapshots[0].objectKey,
    );
    if (!body || body.length > 2_000_000) return;
    await this.syncXmfArtistAliases(notice, body.toString('utf8'));
  }

  private async restoreXmfGalleryIdentityFromRecentSnapshot(
    gallery: CrawlSource,
  ): Promise<void> {
    const festivalSourceUrl = gallery.parserConfig.festivalSourceUrl;
    const snapshots = await this.dataSource.query<{ objectKey: string }[]>(
      `SELECT snapshot."objectKey" AS "objectKey"
       FROM crawl_snapshots snapshot
       JOIN crawl_runs previous ON previous.id = snapshot."runId"
       WHERE previous."sourceId" = $1::uuid
         AND previous."httpStatus" = 200
         AND previous.result IN ('nochange-parsed', 'proposed', 'unchanged')
         AND previous."finishedAt" >= now() - interval '7 days'
         AND snapshot."expiresAt" > now()
       ORDER BY previous."finishedAt" DESC LIMIT 1`,
      [gallery.id],
    );
    if (!snapshots[0]) return;
    const body = await this.imageStorage.readCrawlSnapshot(
      snapshots[0].objectKey,
    );
    if (!body || body.length > 2_000_000) return;
    const html = body.toString('utf8');
    const officialTicketLink = [
      ...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi),
    ].some((link) => {
      try {
        return (
          checkedUrl(link[1].replace(/&amp;/gi, '&')).toString() ===
          festivalSourceUrl
        );
      } catch {
        return false;
      }
    });
    if (!officialTicketLink) return;
    await this.checkRobots('https://xmfestival.com/ajax/get_modal_menu.cm');
    const entries = await crawlArtistGallery(html, gallery.url);
    if (
      !entries.length ||
      new Set(entries.map((entry) => entry.artistName)).size !== entries.length
    )
      return;
    for (const entry of entries) {
      if (!entry.officialSiteKeys.length) continue;
      const imageHint = entry.imageUrl.pathname.replace(/^\/thumbnail\//, '');
      if (imageHint === entry.imageUrl.pathname) continue;
      const rows = await this.dataSource.query<{ id: string }[]>(
        `SELECT source.id FROM crawl_sources source
         WHERE source.kind = 'artist-image' AND source.enabled = true
           AND source.url = $1::text
           AND source."parserConfig"->>'seed' = 'official-artist-gallery'
           AND source."parserConfig"->>'festivalSourceUrl' = $2::text
           AND source."parserConfig"->>'artistName' = $3::text
           AND source."parserConfig"->>'imageHint' = $4::text
           AND NOT (source."parserConfig" ? 'officialSiteKeys')
           AND EXISTS (
             SELECT 1 FROM crawl_images image
             WHERE image."sourceId" = source.id
               AND split_part(image."originUrl", '?', 1) = $5::text)`,
        [
          gallery.url,
          festivalSourceUrl,
          entry.artistName,
          imageHint,
          entry.imageUrl.origin + entry.imageUrl.pathname,
        ],
      );
      if (rows.length !== 1) continue;
      await this.dataSource.query(
        `UPDATE crawl_sources SET
           "parserConfig" = "parserConfig" ||
             jsonb_build_object('officialSiteKeys', $2::jsonb),
           "updatedAt" = now()
         WHERE id = $1::uuid AND kind = 'artist-image' AND enabled = true
           AND url = $3::text
           AND "parserConfig"->>'seed' = 'official-artist-gallery'
           AND "parserConfig"->>'festivalSourceUrl' = $4::text
           AND "parserConfig"->>'artistName' = $5::text
           AND "parserConfig"->>'imageHint' = $6::text
           AND NOT ("parserConfig" ? 'officialSiteKeys')
           AND EXISTS (
             SELECT 1 FROM crawl_images image
             WHERE image."sourceId" = crawl_sources.id
               AND split_part(image."originUrl", '?', 1) = $7::text)`,
        [
          rows[0].id,
          JSON.stringify(entry.officialSiteKeys),
          gallery.url,
          festivalSourceUrl,
          entry.artistName,
          imageHint,
          entry.imageUrl.origin + entry.imageUrl.pathname,
        ],
      );
    }
  }

  private async reconcileRecentXmf403(): Promise<void> {
    const sources = await this.dataSource.query<{ id: string }[]>(
      `SELECT DISTINCT source.id
       FROM crawl_sources source
       JOIN crawl_runs failed ON failed."sourceId" = source.id
       WHERE source.enabled = true
         AND ((source.kind = 'discovery' AND source.url = 'https://xmfestival.com/notice'
           AND source."parserConfig"->>'seed' = 'official-lineup')
           OR (source.kind = 'artist-gallery' AND source.url = 'https://xmfestival.com/lineup'))
         AND failed.result = 'failed' AND failed."httpStatus" = 403
         AND failed."finishedAt" >= now() - interval '7 days'
       UNION
       SELECT gallery.id
       FROM crawl_sources gallery
       WHERE gallery.enabled = true AND gallery.kind = 'artist-gallery'
         AND gallery.url = 'https://xmfestival.com/lineup'
         AND gallery."parserConfig"->>'seed' = 'xmf-official-gallery'
         AND EXISTS (
           SELECT 1 FROM crawl_sources image
           WHERE image.kind = 'artist-image' AND image.enabled = true
             AND image.url = gallery.url
             AND image."parserConfig"->>'seed' = 'official-artist-gallery'
             AND image."parserConfig"->>'festivalSourceUrl' =
               gallery."parserConfig"->>'festivalSourceUrl'
             AND NOT (image."parserConfig" ? 'officialSiteKeys'))
         AND EXISTS (
           SELECT 1 FROM crawl_runs previous
           JOIN crawl_snapshots snapshot ON snapshot."runId" = previous.id
           WHERE previous."sourceId" = gallery.id
             AND previous."httpStatus" = 200
             AND previous.result IN ('nochange-parsed', 'proposed', 'unchanged')
             AND previous."finishedAt" >= now() - interval '7 days'
             AND snapshot."expiresAt" > now())`,
    );
    for (const { id } of sources) {
      try {
        const source = await this.sourcesRepo.findOneBy({ id, enabled: true });
        if (source) await this.syncXmfAliasesFromRecentSnapshot(source);
      } catch {
        this.logger.warn(`XMF 공식 출연진 별칭 복구 실패: source=${id}`);
      }
    }
  }

  private async proposalItems(
    source: CrawlSource,
    parsed: unknown,
  ): Promise<{
    kind: Proposal['kind'];
    items: ProposalItem[];
    matchedProposalId?: string;
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
        { url: string | null; value: unknown; proposalId: string | null }[]
      >(
        `SELECT item->'after'->>'url' AS url, item->'after' AS value,
           p.id AS "proposalId"
         FROM crawl_proposals p, jsonb_array_elements(p.items) item
         WHERE "sourceId" = $1 AND kind = 'festival.new'
           AND status IN ('open', 'partial')
           AND item->>'decision' = 'pending'
         UNION ALL
         SELECT draft->'source'->>'url' AS url, NULL::jsonb AS value,
           NULL::uuid AS "proposalId" FROM admin_festivals
         WHERE draft->'source'->>'url' IS NOT NULL`,
        [source.id],
      );
      const items = parsed.flatMap((entry, index) => {
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
      });
      const entry: unknown = parsed.length === 1 ? parsed[0] : null;
      const matchedProposal =
        items.length === 0 && entry && typeof entry === 'object'
          ? known.find(
              (row) =>
                typeof row.proposalId === 'string' &&
                row.value !== null &&
                row.url === (entry as Record<string, unknown>).url &&
                isDeepStrictEqual(row.value, entry),
            )
          : null;
      return {
        kind: 'festival.new',
        items,
        matchedProposalId: matchedProposal?.proposalId ?? undefined,
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

  private async gmfNotice(source: CrawlSource): Promise<string> {
    await this.checkRobots(GMF_NOTICE_URL);
    const response = await this.getListing({ ...source, url: GMF_NOTICE_URL });
    if (response.status !== 200)
      throw new Error(`GMF 공식 라인업 공지 HTTP ${response.status}`);
    return response.body;
  }

  private async gmfVerifiedImage(source: CrawlSource): Promise<URL> {
    if (source.parserConfig.festivalSourceUrl !== GMF_FESTIVAL_URL)
      throw new Error('GMF 이미지 소스의 축제 연결이 잘못되었습니다.');
    const rows = await this.dataSource.query<{ verifiedEntries: string }[]>(
      `SELECT gallery."parserConfig"->>'verifiedEntries' AS "verifiedEntries"
       FROM crawl_sources gallery
       JOIN crawl_runs verified
         ON verified.id::text = gallery."parserConfig"->>'verifiedRunId'
       WHERE gallery.kind = 'artist-gallery' AND gallery.enabled = true
         AND gallery.url = $1::text
         AND gallery."parserConfig"->>'seed' = 'gmf-official-lineup'
         AND gallery."parserConfig"->>'festivalSourceUrl' = $2::text
         AND gallery."parserConfig"->>'verifiedDate' = $3::text
         AND verified."sourceId" = gallery.id
         AND verified.result = 'nochange-parsed'
         AND verified."finishedAt" IS NOT NULL`,
      [GMF_LINEUP_URL, GMF_FESTIVAL_URL, kstDay()],
    );
    const raw = rows[0]?.verifiedEntries;
    if (!raw || raw.length > 30_000)
      throw new Error('오늘 검증된 GMF 갤러리 결과가 없습니다.');
    let entries: unknown;
    try {
      entries = JSON.parse(raw);
    } catch {
      throw new Error('GMF 검증 갤러리 결과가 잘못되었습니다.');
    }
    if (!Array.isArray(entries) || entries.length < 48 || entries.length > 100)
      throw new Error('GMF 검증 갤러리의 출연진 수가 올바르지 않습니다.');
    const names = new Set<string>();
    const images = new Set<string>();
    let selected: URL | null = null;
    for (const value of entries as unknown[]) {
      const item = value as Record<string, unknown> | null;
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.artistName !== 'string' ||
        typeof item.imageUrl !== 'string'
      )
        throw new Error('GMF 검증 갤러리 항목이 잘못되었습니다.');
      const name = normalizeArtistName(item.artistName);
      let url: URL;
      try {
        url = checkedUrl(item.imageUrl);
      } catch {
        throw new Error('GMF 검증 이미지 URL이 잘못되었습니다.');
      }
      if (
        !name ||
        names.has(name) ||
        images.has(url.href) ||
        url.origin !== 'https://mintpaper.s3.ap-northeast-2.amazonaws.com' ||
        !/^\/GMF_2026_[a-zA-Z0-9_]+\.jpe?g$/.test(url.pathname) ||
        url.search ||
        url.hash
      )
        throw new Error(
          'GMF 검증 이미지 출처 또는 중복 항목이 잘못되었습니다.',
        );
      names.add(name);
      images.add(url.href);
      if (
        item.artistName === source.parserConfig.artistName &&
        url.pathname === source.parserConfig.imageHint
      )
        selected = url;
    }
    if (!selected)
      throw new Error(
        'GMF 출연진 이미지가 오늘의 공식 갤러리에서 확인되지 않았습니다.',
      );
    return selected;
  }

  private async getListing(source: CrawlSource) {
    const response = await this.limitedGet(checkedUrl(source.url));
    if (response.status !== 200) return response;
    if (
      source.url === WONDERLIVET_LINEUP_URL &&
      (source.kind === 'artist-gallery' ||
        (source.kind === 'artist-image' &&
          source.parserConfig.seed === 'official-wonderlivet-lineup'))
    ) {
      const bundleUrl = wonderlivetBundleUrl(response.body);
      await this.checkRobots(bundleUrl.href);
      return this.limitedGet(bundleUrl);
    }
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
    preloaded?: Map<
      string,
      { status: number; body: Buffer; contentType: string }
    >,
  ): Promise<string[]> {
    const stored: string[] = [];
    for (const url of selectRunImages(
      urls,
      source.url,
      run.scheduledDate ?? new Date().toISOString().slice(0, 10),
    )) {
      if (url.toString().length > 2048) continue;
      let validated = false;
      let imagePhase = 'ROBOTS';
      try {
        await this.checkRobots(url.toString());
        imagePhase = 'FETCH';
        const response =
          preloaded?.get(url.toString()) ?? (await this.limitedGetImage(url));
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        imagePhase = 'PREPARE';
        const prepared = await prepareCrawlImage(
          response.body,
          response.contentType,
        );
        if (source.kind === 'artist-image')
          run.contentHash = createHash('sha256')
            .update(run.contentHash ?? '')
            .update(prepared.hash)
            .digest('hex');
        validated = true;
        imagePhase = 'STORE';
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
        if (source.kind === 'artist-image' && source.url === GMF_LINEUP_URL)
          run.error =
            imagePhase === 'ROBOTS'
              ? 'IMAGE_POLICY'
              : imagePhase === 'FETCH'
                ? error instanceof Error && /^HTTP \d{3}$/.test(error.message)
                  ? 'IMAGE_HTTP'
                  : 'IMAGE_FETCH'
                : imagePhase === 'PREPARE'
                  ? 'IMAGE_INVALID'
                  : 'IMAGE_STORE';
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
