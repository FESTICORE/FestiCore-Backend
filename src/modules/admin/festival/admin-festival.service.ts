import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { brotliCompressSync } from 'zlib';
import {
  AdminFestival,
  AdminFestivalVersion,
  FestivalDocument,
} from './festival.entity';
import { mergeDraft, validateDraft } from './festival-validation';

const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
function newId(): string {
  const bytes = randomBytes(8);
  return 'fst_' + [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

function conflict(current: AdminFestival): never {
  throw new HttpException(
    {
      code: 'DRAFT_CONFLICT',
      message: '초안 버전이 변경되었습니다.',
      draft: current.draft,
      draftVersion: current.draftVersion,
    },
    412,
  );
}

@Injectable()
export class AdminFestivalService {
  constructor(
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    @InjectRepository(AdminFestivalVersion)
    private readonly versions: Repository<AdminFestivalVersion>,
    private readonly dataSource: DataSource,
  ) {}

  async list() {
    const rows = await this.festivals.find({ order: { createdAt: 'DESC' } });
    const table = await this.dataSource.query<{ present: string | null }[]>(
      `SELECT to_regclass('crawl_proposals') AS present`,
    );
    const counts = table[0]?.present
      ? await this.dataSource.query<{ festivalId: string; count: number }[]>(
          `SELECT "festivalId", count(*)::int AS count FROM "crawl_proposals" WHERE status = 'open' AND "festivalId" IS NOT NULL GROUP BY "festivalId"`,
        )
      : [];
    const openByFestival = new Map(
      counts.map((count) => [count.festivalId, count.count]),
    );
    return {
      items: rows.map((f) => ({
        id: f.id,
        name: f.draft.name,
        venue: f.draft.venue,
        days: f.draft.days,
        draftVersion: f.draftVersion,
        publishedVersion: f.publishedVersion,
        openProposals: openByFestival.get(f.id) ?? 0,
      })),
    };
  }

  async create(
    input: { name: string; venue: string; days: unknown[] },
    actor: string | null,
  ) {
    const draft: FestivalDocument = {
      id: newId(),
      name: input?.name,
      venue: input?.venue,
      timezone: 'Asia/Seoul',
      days: input?.days,
      flagsEnabled: false,
      stages: [],
      sets: [],
      zones: [],
      flags: [],
      directions: {
        shuttle: null,
        transit: null,
        parking: null,
        memo: null,
        lastShuttleAt: null,
        lastTrainAt: null,
        mapLinks: { naver: null, kakao: null },
        source: {
          name: '관리자 입력',
          url: null,
          verifiedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        },
      },
      checklist: [],
      rules: [],
      mapImageUrl: null,
      mapAspect: null,
      source: {
        name: '관리자 입력',
        url: null,
        verifiedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
    };
    const errors = validateDraft(draft);
    if (errors.length)
      throw new BadRequestException({
        code: 'VALIDATION',
        message: errors.join('; '),
        errors,
      });
    const row = this.festivals.create({
      id: draft.id as string,
      draft,
      draftVersion: 1,
      draftUpdatedBy: actor,
      published: null,
      publishedVersion: 0,
    });
    await this.festivals.save(row);
    return this.draftResponse(row);
  }

  async getDraft(id: string) {
    return this.draftResponse(await this.get(id));
  }

  async patch(
    id: string,
    patch: unknown,
    ifMatch: string | undefined,
    actor: string | null,
  ) {
    const expected = this.matchVersion(ifMatch);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AdminFestival);
      const row = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('페스티벌을 찾을 수 없습니다.');
      if (row.draftVersion !== expected) conflict(row);
      const next = mergeDraft(row.draft, patch);
      const errors = validateDraft(next);
      if (errors.length)
        throw new BadRequestException({
          code: 'VALIDATION',
          message: errors.join('; '),
          errors,
        });
      row.draft = next;
      row.draftVersion++;
      row.draftUpdatedBy = actor;
      await repo.save(row);
      return { ...this.draftResponse(row), warnings: [] };
    });
  }

  async replaceArray(
    id: string,
    field: 'sets' | 'zones',
    items: unknown,
    ifMatch: string | undefined,
    actor: string | null,
  ) {
    if (!Array.isArray(items))
      throw new BadRequestException(`${field}: 배열이 필요합니다.`);
    return this.patch(id, { [field]: items }, ifMatch, actor);
  }

  async diff(id: string) {
    const row = await this.get(id);
    const before = row.published ?? {};
    const after = row.draft;
    const items: { path: string; before: unknown; after: unknown }[] = [];
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        items.push({
          path: `/${key}`,
          before: before[key] ?? null,
          after: after[key] ?? null,
        });
    }
    return { items };
  }

  async publish(id: string, note: string, actor: string | null) {
    if (typeof note !== 'string' || [...note].length > 500)
      throw new BadRequestException('note는 500자 이하의 문자열이어야 합니다.');
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AdminFestival);
      const row = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('페스티벌을 찾을 수 없습니다.');
      const errors = validateDraft(row.draft, true);
      if (errors.length)
        throw new BadRequestException({
          code: 'VALIDATION',
          message: errors.join('; '),
          errors,
        });
      const packVersion = row.publishedVersion + 1;
      const pack = {
        ...row.draft,
        packVersion,
        packUpdatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      if (
        brotliCompressSync(Buffer.from(JSON.stringify(pack))).length >
        200 * 1024
      )
        throw new BadRequestException('압축된 팩이 200KB를 초과합니다.');
      const sizeBytes = Buffer.byteLength(JSON.stringify(pack));
      row.published = pack;
      row.publishedVersion = packVersion;
      await repo.save(row);
      await manager.getRepository(AdminFestivalVersion).save({
        festivalId: id,
        packVersion,
        pack,
        publishedBy: actor,
        note,
        sizeBytes,
      });
      const pushedDevices = await this.queuePackUpdate(
        manager,
        id,
        packVersion,
      );
      return { packVersion, etag: `"v${packVersion}"`, pushedDevices };
    });
  }

  async versionsList(id: string) {
    await this.get(id);
    const rows = await this.versions.find({
      where: { festivalId: id },
      order: { packVersion: 'DESC' },
    });
    return {
      items: rows.map(
        ({ packVersion, publishedAt, publishedBy, note, sizeBytes }) => ({
          packVersion,
          publishedAt,
          publishedBy,
          note,
          sizeBytes,
        }),
      ),
    };
  }

  async rollback(id: string, toVersion: number, actor: string | null) {
    if (!Number.isSafeInteger(toVersion) || toVersion < 1)
      throw new BadRequestException('toVersion은 양의 정수여야 합니다.');
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AdminFestival);
      const row = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('페스티벌을 찾을 수 없습니다.');
      const target = await manager
        .getRepository(AdminFestivalVersion)
        .findOneBy({ festivalId: id, packVersion: toVersion });
      if (!target) throw new NotFoundException('발행 버전을 찾을 수 없습니다.');
      const packVersion = row.publishedVersion + 1;
      const pack = {
        ...target.pack,
        packVersion,
        packUpdatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      if (
        brotliCompressSync(Buffer.from(JSON.stringify(pack))).length >
        200 * 1024
      )
        throw new BadRequestException('압축된 팩이 200KB를 초과합니다.');
      row.published = pack;
      row.publishedVersion = packVersion;
      await repo.save(row);
      await manager.getRepository(AdminFestivalVersion).save({
        festivalId: id,
        packVersion,
        pack,
        publishedBy: actor,
        note: `Rollback to ${toVersion}`,
        sizeBytes: Buffer.byteLength(JSON.stringify(pack)),
      });
      const pushedDevices = await this.queuePackUpdate(
        manager,
        id,
        packVersion,
      );
      return { packVersion, etag: `"v${packVersion}"`, pushedDevices };
    });
  }

  private async queuePackUpdate(
    manager: EntityManager,
    id: string,
    version: number,
  ): Promise<number> {
    const queued = await manager.query<{ id: string }[]>(
      `INSERT INTO "notification_deliveries"
        ("id", "deviceId", "festivalId", "eventKey", "scheduledAt", "nextAttemptAt")
       SELECT gen_random_uuid(), s."deviceId", $1, $2, now(), now()
       FROM "device_subscriptions" s
       JOIN "devices" d ON d."id" = s."deviceId"
       WHERE s."festivalId" = $1 AND s."packUpdates" = true
         AND d."apnsToken" IS NOT NULL AND d."apnsEnvironment" IS NOT NULL
       ON CONFLICT ("deviceId", "eventKey") DO NOTHING
       RETURNING "id"`,
      [id, `pack-updated:${id}:${version}`],
    );
    return queued.length;
  }

  private async get(id: string): Promise<AdminFestival> {
    const row = await this.festivals.findOneBy({ id });
    if (!row) throw new NotFoundException('페스티벌을 찾을 수 없습니다.');
    return row;
  }

  private matchVersion(value: string | undefined): number {
    if (!value || !/^"d[1-9]\d*"$/.test(value))
      throw new HttpException(
        'If-Match: "d{draftVersion}" 헤더가 필요합니다.',
        428,
      );
    return Number(value.slice(2, -1));
  }

  private draftResponse(row: AdminFestival) {
    return {
      ...row.draft,
      draftVersion: row.draftVersion,
      draftUpdatedAt: row.draftUpdatedAt,
      draftUpdatedBy: row.draftUpdatedBy,
    };
  }
}
