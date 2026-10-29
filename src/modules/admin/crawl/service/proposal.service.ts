import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import {
  venueLabelMatches,
  venuePoint,
  verifiedVenueLocation,
} from '../../../../common/festival-location';
import {
  AdminFestival,
  FestivalDocument,
} from '../../festival/festival.entity';
import { validateDraft } from '../../festival/festival-validation';
import { AdminAuditService } from '../../audit/admin-audit.service';
import { Proposal, ProposalItem } from '../entity/proposal.entity';
import { CrawlSource } from '../entity/crawl-source.entity';
import { ticketDateRange } from '../../../public/crawl-catalog';

function segments(pointer: string): string[] {
  if (!pointer.startsWith('/'))
    throw new BadRequestException('JSON Pointer 경로가 잘못되었습니다.');
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function readAt(root: unknown, pointer: string): unknown {
  return segments(pointer).reduce<unknown>((value, key) => {
    if (value && typeof value === 'object')
      return (value as Record<string, unknown>)[key];
    return undefined;
  }, root);
}

function readItem(root: FestivalDocument, item: ProposalItem): unknown {
  if (item.path.startsWith('/sets/') && item.before) {
    const expectedId = (item.before as Record<string, unknown>).id;
    const sets = root.sets;
    if (Array.isArray(sets))
      return sets.find(
        (set: unknown) =>
          set &&
          typeof set === 'object' &&
          (set as Record<string, unknown>).id === expectedId,
      );
  }
  return readAt(root, item.path);
}

function applyItem(
  root: FestivalDocument,
  item: ProposalItem,
): FestivalDocument {
  const copy = structuredClone(root);
  const parts = segments(item.path);
  let parent: unknown = copy;
  for (const key of parts.slice(0, -1)) {
    parent =
      parent && typeof parent === 'object'
        ? (parent as Record<string, unknown>)[key]
        : undefined;
  }
  if (!parent || typeof parent !== 'object')
    throw new Error('초안에 경로가 없습니다.');
  const key = parts.at(-1)!;
  if (Array.isArray(parent)) {
    const expectedId =
      item.path.startsWith('/sets/') && item.before
        ? (item.before as Record<string, unknown>).id
        : undefined;
    const index =
      key === '-'
        ? parent.length
        : expectedId === undefined
          ? Number(key)
          : parent.findIndex(
              (entry: unknown) =>
                entry &&
                typeof entry === 'object' &&
                (entry as Record<string, unknown>).id === expectedId,
            );
    if (!Number.isInteger(index) || index < 0 || index > parent.length)
      throw new Error('배열 경로가 잘못되었습니다.');
    if (item.op === 'add') parent.splice(index, 0, item.after);
    else if (item.op === 'remove') parent.splice(index, 1);
    else if (index < parent.length) parent[index] = item.after;
    else throw new Error('배열 항목이 없습니다.');
  } else {
    const object = parent as Record<string, unknown>;
    if (item.op === 'remove') delete object[key];
    else object[key] = item.after;
  }
  return copy;
}

const festivalIdAlphabet = '0123456789abcdefghjkmnpqrstvwxyz';

function newFestivalId(): string {
  return (
    'fst_' +
    [...randomBytes(8)]
      .map((byte) => festivalIdAlphabet[byte % festivalIdAlphabet.length])
      .join('')
  );
}

function discoveryDraft(
  value: unknown,
  reviewed: unknown,
  source: CrawlSource,
  verifiedAt: string,
): FestivalDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('발견 항목에 축제 정보가 없습니다.');
  const entry = value as Record<string, unknown>;
  if (reviewed !== undefined) {
    if (!reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed))
      throw new Error('관리자 검토 값은 객체여야 합니다.');
    const fields = Object.keys(reviewed);
    if (fields.some((field) => !['name', 'venue', 'days'].includes(field)))
      throw new Error(
        '관리자 검토 값에는 이름, 장소, 날짜만 입력할 수 있습니다.',
      );
    Object.assign(entry, reviewed);
  }
  if (typeof entry.url !== 'string')
    throw new Error('발견 항목에 축제 URL이 없습니다.');
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    throw new Error('발견 항목의 축제 URL이 잘못되었습니다.');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('축제 URL은 인증 정보가 없는 HTTPS 주소여야 합니다.');
  const isWorldNol =
    /^https:\/\/world\.nol\.com\/en\/ticket\/products\/\d+$/.test(
      url.toString(),
    );
  const eventPeriod = ticketDateRange(entry.date, isWorldNol ? 31 : 6);
  if (isWorldNol && !eventPeriod)
    throw new Error(
      'NOL World 발견 날짜 범위가 유효하지 않거나 32일을 초과합니다.',
    );
  const days =
    entry.days === undefined ? (eventPeriod ? [] : undefined) : entry.days;
  if (
    eventPeriod &&
    Array.isArray(days) &&
    days.length > 0 &&
    ((days[0] as { date?: unknown } | undefined)?.date !==
      eventPeriod.firstDate ||
      (days[days.length - 1] as { date?: unknown } | undefined)?.date !==
        eventPeriod.lastDate)
  )
    throw new Error(
      'days의 첫날과 마지막 날은 발견된 축제 날짜 범위와 같아야 합니다.',
    );
  const provenance = {
    name: source.parserConfig.sourceName || new URL(source.url).hostname,
    url: url.toString(),
    verifiedAt,
  };
  const point = venuePoint(entry.location);
  const location =
    url.hostname === 'ticket.melon.com' &&
    url.pathname === '/performance/index.htm' &&
    /^\d+$/.test(url.searchParams.get('prodId') ?? '') &&
    point?.label === entry.venue
      ? { ...point, source: provenance }
      : null;
  const draft: FestivalDocument = {
    id: newFestivalId(),
    name: entry.name,
    venue: entry.venue,
    timezone: 'Asia/Seoul',
    days,
    ...(eventPeriod ? { eventPeriod } : {}),
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
      location,
      source: provenance,
    },
    checklist: [],
    rules: [],
    mapImageUrl: null,
    mapAspect: null,
    source: provenance,
  };
  const errors = validateDraft(draft);
  if (errors.length) throw new Error(errors.join('; '));
  return draft;
}

@Injectable()
export class ProposalService {
  constructor(
    @InjectRepository(Proposal)
    private readonly proposals: Repository<Proposal>,
    private readonly dataSource: DataSource,
    private readonly audit: AdminAuditService,
  ) {}

  async list(festivalId?: string, status = 'open') {
    const qb = this.proposals.createQueryBuilder('proposal');
    if (festivalId)
      qb.andWhere('proposal.festivalId = :festivalId', { festivalId });
    if (status) qb.andWhere('proposal.status = :status', { status });
    return { items: await qb.orderBy('proposal.createdAt', 'DESC').getMany() };
  }

  async get(id: string) {
    const proposal = await this.proposals.findOneBy({ id });
    if (!proposal) throw new NotFoundException('제안을 찾을 수 없습니다.');
    const festival = proposal.festivalId
      ? await this.dataSource
          .getRepository(AdminFestival)
          .findOneBy({ id: proposal.festivalId })
      : null;
    return {
      ...proposal,
      currentDraftValues: Object.fromEntries(
        proposal.items.map((item) => [
          item.id,
          festival ? (readItem(festival.draft, item) ?? null) : null,
        ]),
      ),
    };
  }

  async decide(
    id: string,
    decisions: {
      itemId: string;
      decision: 'accepted' | 'rejected';
      after?: unknown;
    }[],
    actor: string | null,
  ) {
    if (
      !Array.isArray(decisions) ||
      !decisions.length ||
      decisions.some(
        (d) =>
          !d ||
          typeof d.itemId !== 'string' ||
          !['accepted', 'rejected'].includes(d.decision),
      )
    ) {
      throw new BadRequestException('결정 항목이 필요합니다.');
    }
    if (new Set(decisions.map((d) => d.itemId)).size !== decisions.length) {
      throw new BadRequestException('항목을 중복 결정할 수 없습니다.');
    }
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Proposal);
      const proposal = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!proposal) throw new NotFoundException('제안을 찾을 수 없습니다.');
      if (!['open', 'partial'].includes(proposal.status))
        throw new BadRequestException('이미 결정된 제안입니다.');
      const before = {
        status: proposal.status,
        decisions: proposal.items.map(({ id: itemId, decision }) => ({
          itemId,
          decision,
        })),
      };
      const festival = proposal.festivalId
        ? await manager.getRepository(AdminFestival).findOne({
            where: { id: proposal.festivalId },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      const source = proposal.sourceId
        ? await manager
            .getRepository(CrawlSource)
            .findOneBy({ id: proposal.sourceId })
        : null;
      const originalDraft = festival ? structuredClone(festival.draft) : null;
      const originalDraftVersion = festival?.draftVersion ?? null;
      let draft = festival?.draft;
      let changed = false;
      let createdDraftVersion: number | null = null;
      let createdFestivalId: string | null = null;
      const createdDrafts: FestivalDocument[] = [];
      const conflicts: { itemId: string; reason: string }[] = [];
      const now = new Date().toISOString();
      for (const decision of decisions) {
        const item = proposal.items.find(
          (entry) => entry.id === decision.itemId,
        );
        if (!item)
          throw new BadRequestException(
            `제안 항목을 찾을 수 없습니다: ${decision.itemId}`,
          );
        if (item.decision !== 'pending')
          throw new BadRequestException(
            `이미 결정된 항목입니다: ${decision.itemId}`,
          );
        if (
          decision.after !== undefined &&
          (proposal.kind !== 'festival.new' || decision.decision !== 'accepted')
        )
          throw new BadRequestException(
            '검토 값은 신규 축제 승인에만 입력할 수 있습니다.',
          );
        if (
          decision.decision === 'accepted' &&
          proposal.kind === 'festival.new'
        ) {
          try {
            if (
              proposal.festivalId ||
              !source ||
              source.kind !== 'discovery' ||
              source.festivalId
            )
              throw new Error('발견 제안의 출처가 올바르지 않습니다.');
            const next = discoveryDraft(
              structuredClone(item.after),
              decision.after,
              source,
              now.replace(/\.\d{3}Z$/, 'Z'),
            );
            const url = (next.source as { url: string }).url;
            await manager.query(
              'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
              ['festival.discovery', url],
            );
            const existing = await manager
              .getRepository(AdminFestival)
              .createQueryBuilder('festival')
              .where("festival.draft->'source'->>'url' = :url", { url })
              .getOne();
            if (existing)
              throw new Error('같은 축제 URL의 초안이 이미 있습니다.');
            await manager.getRepository(AdminFestival).save(
              manager.getRepository(AdminFestival).create({
                id: next.id as string,
                draft: next,
                draftVersion: 1,
                draftUpdatedBy: actor,
                published: null,
                publishedVersion: 0,
              }),
            );
            createdDraftVersion = 1;
            createdFestivalId = next.id as string;
            createdDrafts.push(next);
          } catch (error) {
            conflicts.push({
              itemId: item.id,
              reason: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
        }
        if (
          decision.decision === 'accepted' &&
          proposal.kind !== 'notice.new' &&
          proposal.kind !== 'festival.new'
        ) {
          if (!draft) {
            conflicts.push({
              itemId: item.id,
              reason: '초안을 찾을 수 없습니다.',
            });
            continue;
          }
          const before = readItem(draft, item);
          if (
            JSON.stringify(before ?? null) !==
            JSON.stringify(item.before ?? null)
          ) {
            conflicts.push({
              itemId: item.id,
              reason: '초안의 이전 값이 변경되었습니다.',
            });
            continue;
          }
          try {
            if (
              proposal.kind === 'directions.diff' &&
              item.path === '/directions/location'
            ) {
              const location = verifiedVenueLocation(item.after);
              if (
                !source ||
                !/^https:\/\/ticket\.melon\.com\/performance\/index\.htm\?prodId=\d+$/.test(
                  source.url,
                ) ||
                (draft.source as { url?: unknown } | null)?.url !==
                  source.url ||
                !location ||
                location.source.url !== source.url ||
                !venueLabelMatches(location.label, draft.venue)
              )
                throw new Error(
                  '공연장 좌표의 출처 또는 장소가 초안과 일치하지 않습니다.',
                );
            }
            const next = applyItem(draft, item);
            if (source) {
              const verified = {
                name:
                  source.parserConfig.sourceName ||
                  new URL(source.url).hostname,
                url: source.url,
                verifiedAt: now.replace(/\.\d{3}Z$/, 'Z'),
              };
              next.source = verified;
              if (proposal.kind === 'directions.diff') {
                next.directions = {
                  ...(next.directions as Record<string, unknown>),
                  source: verified,
                };
              }
            }
            const errors = validateDraft(next);
            if (errors.length) throw new Error(errors.join('; '));
            draft = next;
            changed = true;
          } catch (error) {
            conflicts.push({
              itemId: item.id,
              reason: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
        }
        // 공지는 관리자가 검토 후 수동으로 작성한다.
        item.decision = decision.decision;
        item.decidedBy = actor;
        item.decidedAt = now;
      }
      if (changed && festival && draft) {
        festival.draft = draft;
        festival.draftVersion++;
        festival.draftUpdatedBy = actor;
        await manager.getRepository(AdminFestival).save(festival);
        await this.audit.record(manager, {
          actor,
          action: 'festival.draft.updated',
          target: `festival:${festival.id}`,
          before: { draftVersion: originalDraftVersion, draft: originalDraft },
          after: { draftVersion: festival.draftVersion, draft },
        });
      }
      for (const created of createdDrafts) {
        await this.audit.record(manager, {
          actor,
          action: 'festival.created',
          target: `festival:${String(created.id)}`,
          before: null,
          after: { draftVersion: 1, draft: created },
        });
      }
      const pending = proposal.items.some(
        (item) => item.decision === 'pending',
      );
      const accepted = proposal.items.some(
        (item) => item.decision === 'accepted',
      );
      proposal.status = pending
        ? 'open'
        : accepted &&
            proposal.items.some((item) => item.decision === 'rejected')
          ? 'partial'
          : accepted
            ? 'applied'
            : 'rejected';
      await repo.save(proposal);
      await this.audit.record(manager, {
        actor,
        action: 'crawl.proposal.decided',
        target: `proposal:${id}`,
        before,
        after: {
          status: proposal.status,
          decisions: proposal.items.map(({ id: itemId, decision }) => ({
            itemId,
            decision,
          })),
          festivalId: proposal.festivalId ?? createdFestivalId,
          draftVersion: festival?.draftVersion ?? createdDraftVersion,
          conflicts,
        },
      });
      return {
        proposal,
        conflicts,
        draftVersion: festival?.draftVersion ?? createdDraftVersion,
      };
    });
  }

  async dismiss(id: string, reason: string, actor: string | null) {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
      throw new BadRequestException('거절 사유는 1..500자여야 합니다.');
    }
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Proposal);
      const proposal = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!proposal) throw new NotFoundException('제안을 찾을 수 없습니다.');
      if (!['open', 'partial'].includes(proposal.status))
        throw new BadRequestException('이미 결정된 제안입니다.');
      const before = {
        status: proposal.status,
        pendingItemIds: proposal.items
          .filter((item) => item.decision === 'pending')
          .map((item) => item.id),
      };
      const now = new Date().toISOString();
      for (const item of proposal.items) {
        if (item.decision === 'pending')
          Object.assign(item, {
            decision: 'rejected',
            decidedBy: actor,
            decidedAt: now,
          });
      }
      proposal.status = proposal.items.some(
        (item) => item.decision === 'accepted',
      )
        ? 'partial'
        : 'rejected';
      proposal.evidence = {
        ...proposal.evidence,
        dismissReason: reason.trim(),
      } as Proposal['evidence'];
      const saved = await repo.save(proposal);
      await this.audit.record(manager, {
        actor,
        action: 'crawl.proposal.dismissed',
        target: `proposal:${id}`,
        before,
        after: { status: proposal.status, reason: reason.trim() },
      });
      return saved;
    });
  }
}
