import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { User } from '../auth/entity/user.entity';
import { SocialNotificationService } from '../notification/social-notification.service';
import { LiveActivityService } from '../notification/live-activity.service';
import {
  Crew,
  CrewGather,
  CrewMember,
  CrewState,
  CrewStatusIdempotency,
} from './crew.entity';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_MS = 48 * 60 * 60_000;
const GATHER_MS = 10 * 60_000;

function error(code: string, message: string) {
  return { code, message };
}

function name(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    [...value.trim()].length < 1 ||
    [...value.trim()].length > max
  )
    throw new BadRequestException(
      error('VALIDATION', `1..${max}자 문자열이 필요합니다.`),
    );
  return value.trim();
}

function inviteCode(): string {
  const alphabetSize = CODE_ALPHABET.length;
  const cutoff = Math.floor(256 / alphabetSize) * alphabetSize;
  let result = '';
  while (result.length < 6) {
    for (const byte of randomBytes(8)) {
      if (byte < cutoff) result += CODE_ALPHABET[byte % alphabetSize];
      if (result.length === 6) break;
    }
  }
  return result;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === 'object' && !Array.isArray(entry),
      )
    : [];
}

@Injectable()
export class CrewService {
  constructor(
    @InjectRepository(Crew) private readonly crews: Repository<Crew>,
    @InjectRepository(CrewMember)
    private readonly members: Repository<CrewMember>,
    @InjectRepository(CrewGather)
    private readonly gathers: Repository<CrewGather>,
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly socialNotifications: SocialNotificationService,
    private readonly liveActivity: LiveActivityService,
  ) {}

  private async festival(id: string): Promise<AdminFestival> {
    const festival = await this.festivals.findOne({ where: { id } });
    if (!festival?.published)
      throw new NotFoundException(
        error('NOT_FOUND', '페스티벌을 찾을 수 없습니다.'),
      );
    return festival;
  }

  private archiveTime(festival: AdminFestival): number {
    const days = list(festival.published?.days);
    const ends = days
      .map((day) =>
        Date.parse(typeof day.endsAt === 'string' ? day.endsAt : ''),
      )
      .filter(Number.isFinite);
    return ends.length ? Math.max(...ends) + 24 * 60 * 60_000 : Infinity;
  }

  private async active(crew: Crew): Promise<void> {
    const festival = await this.festival(crew.festivalId);
    if (!crew.archivedAt && Date.now() >= this.archiveTime(festival)) {
      await this.crews.manager.transaction(async (manager) => {
        crew.archivedAt = new Date();
        await manager.getRepository(Crew).save(crew);
        await this.liveActivity.enqueueCrewMembers(
          crew.id,
          crew.festivalId,
          manager,
        );
      });
    }
    if (crew.archivedAt)
      throw new GoneException(error('CREW_ARCHIVED', '보관된 크루입니다.'));
  }

  private async member(
    crewId: string,
    userId: string,
  ): Promise<{ crew: Crew; member: CrewMember }> {
    const crew = await this.crews.findOne({ where: { id: crewId } });
    if (!crew)
      throw new NotFoundException(
        error('NOT_FOUND', '크루를 찾을 수 없습니다.'),
      );
    const member = await this.members.findOne({ where: { crewId, userId } });
    if (!member)
      throw new ForbiddenException(
        error('CREW_NOT_MEMBER', '크루 멤버만 접근할 수 있습니다.'),
      );
    return { crew, member };
  }

  private owner(crew: Crew, userId: string): void {
    if (crew.ownerId !== userId)
      throw new ForbiddenException(
        error('CREW_NOT_OWNER', '크루장만 변경할 수 있습니다.'),
      );
  }

  private async lockedCrew(
    manager: EntityManager,
    id: string,
    userId: string,
  ): Promise<Crew> {
    const crew = await manager.getRepository(Crew).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!crew)
      throw new NotFoundException(
        error('NOT_FOUND', '크루를 찾을 수 없습니다.'),
      );
    if (
      !(await manager
        .getRepository(CrewMember)
        .findOne({ where: { crewId: id, userId } }))
    )
      throw new ForbiddenException(
        error('CREW_NOT_MEMBER', '크루 멤버만 접근할 수 있습니다.'),
      );
    if (crew.archivedAt)
      throw new GoneException(error('CREW_ARCHIVED', '보관된 크루입니다.'));
    return crew;
  }

  private async freshInviteCode(manager: EntityManager): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = inviteCode();
      if (
        !(await manager
          .getRepository(Crew)
          .findOne({ where: { inviteCode: code } }))
      )
        return code;
    }
    throw new ConflictException(
      error('INVITE_CODE_UNAVAILABLE', '새 초대 코드를 발급할 수 없습니다.'),
    );
  }

  private async zone(festivalId: string, zoneId: string): Promise<void> {
    const festival = await this.festival(festivalId);
    if (!list(festival.published?.zones).some((zone) => zone.id === zoneId))
      throw new NotFoundException(
        error('ZONE_NOT_FOUND', '존을 찾을 수 없습니다.'),
      );
  }

  private async display(crew: Crew, userId: string, live = false) {
    const members = await this.members.find({
      where: { crewId: crew.id },
      order: { joinedAt: 'ASC' },
    });
    const latestGather = live
      ? await this.gathers.findOne({
          where: { crewId: crew.id },
          order: { createdAt: 'DESC' },
        })
      : null;
    const nextGather = crew.lastGatherAt
      ? new Date(crew.lastGatherAt.getTime() + GATHER_MS)
      : null;
    return {
      id: crew.id,
      visibility: 'private' as const,
      name: crew.name,
      festivalId: crew.festivalId,
      ownerId: crew.ownerId,
      members: members.map(({ userId, nickname, joinedAt }) => ({
        userId,
        nickname,
        joinedAt,
      })),
      inviteCode: crew.ownerId === userId ? crew.inviteCode : null,
      inviteExpiresAt: crew.ownerId === userId ? crew.inviteExpiresAt : null,
      archivedAt: crew.archivedAt,
      ...(live
        ? {
            live: {
              id: crew.id,
              name: crew.name,
              ownerId: crew.ownerId,
              members: members.map(
                ({ userId, nickname, zoneId, state, statusUpdatedAt }) => ({
                  userId,
                  nickname,
                  zoneId,
                  state,
                  updatedAt: statusUpdatedAt,
                }),
              ),
              gatherRequest:
                latestGather &&
                latestGather.createdAt.getTime() + GATHER_MS > Date.now()
                  ? {
                      zoneId: latestGather.zoneId,
                      byUserId: latestGather.byUserId,
                      at: latestGather.createdAt,
                    }
                  : null,
              gatherAvailableAt:
                nextGather && nextGather.getTime() > Date.now()
                  ? nextGather
                  : null,
            },
          }
        : {}),
    };
  }

  async create(
    userId: string,
    body: { festivalId?: string; name?: string; nickname?: string },
  ) {
    if (typeof body?.festivalId !== 'string')
      throw new BadRequestException(
        error('VALIDATION', 'festivalId가 필요합니다.'),
      );
    const festival = await this.festival(body.festivalId);
    if (Date.now() >= this.archiveTime(festival))
      throw new GoneException(
        error('FESTIVAL_ENDED', '종료된 페스티벌입니다.'),
      );
    const crewName = name(body.name, 20);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user)
      throw new NotFoundException(
        error('NOT_FOUND', '사용자를 찾을 수 없습니다.'),
      );
    const nickname = name(body.nickname ?? user.nickname, 12);
    try {
      const crew = await this.crews.manager.transaction(async (manager) => {
        const existing = await manager
          .getRepository(CrewMember)
          .findOne({ where: { festivalId: festival.id, userId } });
        if (existing)
          throw new ConflictException({
            ...error('CREW_ALREADY_IN', '이미 크루에 속해 있습니다.'),
            crewId: existing.crewId,
          });
        const row = manager.getRepository(Crew).create({
          id: `flg_${randomBytes(8).toString('hex')}`,
          festivalId: festival.id,
          name: crewName,
          ownerId: userId,
          inviteCode: await this.freshInviteCode(manager),
          inviteExpiresAt: new Date(Date.now() + INVITE_MS),
          archivedAt: null,
          lastGatherAt: null,
        });
        await manager.getRepository(Crew).save(row);
        await manager.getRepository(CrewMember).save(
          manager.getRepository(CrewMember).create({
            crewId: row.id,
            userId,
            festivalId: festival.id,
            nickname,
            zoneId: null,
            state: null,
            statusUpdatedAt: null,
          }),
        );
        await this.liveActivity.enqueueCrewMembers(
          row.id,
          row.festivalId,
          manager,
        );
        return row;
      });
      return this.display(crew, userId);
    } catch (cause) {
      if (cause instanceof HttpException) throw cause;
      if ((cause as { code?: string }).code === '23505') {
        if (
          (cause as { constraint?: string }).constraint ===
          'UQ_crews_invite_code'
        )
          throw new ConflictException(
            error(
              'INVITE_CODE_UNAVAILABLE',
              '새 초대 코드를 발급할 수 없습니다.',
            ),
          );
        const existing = await this.members.findOne({
          where: { festivalId: festival.id, userId },
        });
        if (existing)
          throw new ConflictException({
            ...error('CREW_ALREADY_IN', '이미 크루에 속해 있습니다.'),
            crewId: existing.crewId,
          });
      }
      throw cause;
    }
  }

  async detail(id: string, userId: string) {
    const { crew } = await this.member(id, userId);
    // 보관된 크루의 GET은 허용한다.
    return this.display(crew, userId, true);
  }

  async invite(raw: string) {
    const code = typeof raw === 'string' ? raw.toUpperCase() : '';
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code))
      throw new NotFoundException(
        error('NOT_FOUND', '초대를 찾을 수 없습니다.'),
      );
    const crew = await this.crews.findOne({ where: { inviteCode: code } });
    if (
      !crew ||
      crew.archivedAt ||
      crew.inviteExpiresAt.getTime() <= Date.now()
    )
      throw new NotFoundException(
        error('NOT_FOUND', '초대를 찾을 수 없습니다.'),
      );
    const festival = await this.festival(crew.festivalId);
    if (Date.now() >= this.archiveTime(festival))
      throw new NotFoundException(
        error('NOT_FOUND', '초대를 찾을 수 없습니다.'),
      );
    const count = await this.members.count({ where: { crewId: crew.id } });
    return {
      crewName: crew.name,
      festivalId: crew.festivalId,
      festivalName: festival.published?.name,
      memberCount: count,
      expiresAt: crew.inviteExpiresAt,
    };
  }

  async join(userId: string, body: { inviteCode?: string; nickname?: string }) {
    const code =
      typeof body?.inviteCode === 'string' ? body.inviteCode.toUpperCase() : '';
    if (!code || !/^[A-HJ-NP-Z2-9]{6}$/.test(code))
      throw new NotFoundException(
        error('NOT_FOUND', '초대를 찾을 수 없습니다.'),
      );
    let crew: Crew;
    try {
      crew = await this.crews.manager.transaction(async (manager) => {
        const row = await manager.getRepository(Crew).findOne({
          where: { inviteCode: code },
          lock: { mode: 'pessimistic_write' },
        });
        if (!row)
          throw new NotFoundException(
            error('NOT_FOUND', '초대를 찾을 수 없습니다.'),
          );
        const prior = await manager
          .getRepository(CrewMember)
          .findOne({ where: { festivalId: row.festivalId, userId } });
        if (prior?.crewId === row.id) return row;
        if (row.inviteExpiresAt.getTime() <= Date.now())
          throw new GoneException(
            error('INVITE_EXPIRED', '초대가 만료되었습니다.'),
          );
        if (row.archivedAt)
          throw new GoneException(error('CREW_ARCHIVED', '보관된 크루입니다.'));
        const festival = await this.festival(row.festivalId);
        if (Date.now() >= this.archiveTime(festival)) {
          throw new GoneException(error('CREW_ARCHIVED', '보관된 크루입니다.'));
        }
        if (prior)
          throw new ConflictException({
            ...error('CREW_ALREADY_IN', '이미 다른 크루에 속해 있습니다.'),
            crewId: prior.crewId,
          });
        const user = await this.users.findOne({ where: { id: userId } });
        if (!user)
          throw new NotFoundException(
            error('NOT_FOUND', '사용자를 찾을 수 없습니다.'),
          );
        const nickname = name(body.nickname ?? user.nickname, 12);
        if (
          (await manager
            .getRepository(CrewMember)
            .count({ where: { crewId: row.id } })) >= 12
        )
          throw new ConflictException(
            error('CREW_FULL', '크루 정원은 12명입니다.'),
          );
        await manager.getRepository(CrewMember).save(
          manager.getRepository(CrewMember).create({
            crewId: row.id,
            userId,
            festivalId: row.festivalId,
            nickname,
            zoneId: null,
            state: null,
            statusUpdatedAt: null,
          }),
        );
        await this.liveActivity.enqueueCrewMembers(
          row.id,
          row.festivalId,
          manager,
        );
        return row;
      });
    } catch (cause) {
      if (cause instanceof HttpException) throw cause;
      if ((cause as { code?: string }).code === '23505')
        throw new ConflictException(
          error('CREW_ALREADY_IN', '이미 크루에 속해 있습니다.'),
        );
      throw cause;
    }
    return this.display(crew, userId, true);
  }

  async rotate(id: string, userId: string) {
    const { crew } = await this.member(id, userId);
    this.owner(crew, userId);
    await this.active(crew);
    try {
      return await this.crews.manager.transaction(async (manager) => {
        const locked = await this.lockedCrew(manager, id, userId);
        this.owner(locked, userId);
        locked.inviteCode = await this.freshInviteCode(manager);
        locked.inviteExpiresAt = new Date(Date.now() + INVITE_MS);
        await manager.getRepository(Crew).save(locked);
        return {
          inviteCode: locked.inviteCode,
          inviteExpiresAt: locked.inviteExpiresAt,
        };
      });
    } catch (cause) {
      if (
        (cause as { code?: string; constraint?: string }).code === '23505' &&
        (cause as { constraint?: string }).constraint === 'UQ_crews_invite_code'
      )
        throw new ConflictException(
          error(
            'INVITE_CODE_UNAVAILABLE',
            '새 초대 코드를 발급할 수 없습니다.',
          ),
        );
      throw cause;
    }
  }

  async status(
    id: string,
    userId: string,
    body: { zoneId?: string; state?: CrewState; clientAt?: string },
    key?: string,
  ) {
    const { crew } = await this.member(id, userId);
    return this.crews.manager.transaction(async (manager: EntityManager) => {
      let idempotency: Repository<CrewStatusIdempotency> | undefined;
      let requestHash: string | undefined;
      if (key) {
        requestHash = createHash('sha256')
          .update(
            JSON.stringify({
              id,
              clientAt: body.clientAt,
              zoneId: body.zoneId,
              state: body.state,
            }),
          )
          .digest('hex');
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
          [userId, key],
        );
        idempotency = manager.getRepository(CrewStatusIdempotency);
        const prior = await idempotency.findOne({ where: { userId, key } });
        if (prior && prior.expiresAt > new Date()) {
          const member = await manager.getRepository(CrewMember).findOne({
            where: { crewId: id, userId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!member)
            throw new ForbiddenException(
              error('CREW_NOT_MEMBER', '크루 멤버만 접근할 수 있습니다.'),
            );
          if (prior.requestHash !== requestHash)
            throw new ConflictException(
              error(
                'IDEMPOTENCY_CONFLICT',
                '같은 키로 다른 요청을 보냈습니다.',
              ),
            );
          return prior.response;
        }
        if (prior) await idempotency.delete({ userId, key });
      }
      const remember = async (response: Record<string, unknown>) => {
        if (idempotency && key && requestHash)
          await idempotency.save({
            userId,
            key,
            requestHash,
            response,
            expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
          });
        return response;
      };
      await this.active(crew);
      const time = Date.parse(body?.clientAt ?? '');
      if (!Number.isFinite(time) || Math.abs(Date.now() - time) > 5 * 60_000)
        throw new BadRequestException(
          error('VALIDATION', 'clientAt은 현재 시각에서 5분 이내여야 합니다.'),
        );
      if (body.zoneId === undefined && body.state === undefined)
        throw new BadRequestException(
          error('VALIDATION', 'zoneId 또는 state가 필요합니다.'),
        );
      if (
        body.state !== undefined &&
        !['here', 'eating', 'toilet', 'leaving'].includes(body.state)
      )
        throw new BadRequestException(
          error('VALIDATION', '유효하지 않은 상태입니다.'),
        );
      if (body.zoneId !== undefined && body.state !== 'leaving')
        await this.zone(crew.festivalId, body.zoneId);
      await this.lockedCrew(manager, id, userId);
      const repository = manager.getRepository(CrewMember);
      const member = await repository.findOne({
        where: { crewId: id, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!member)
        throw new ForbiddenException(
          error('CREW_NOT_MEMBER', '크루 멤버만 접근할 수 있습니다.'),
        );
      if (member.statusUpdatedAt && time <= member.statusUpdatedAt.getTime()) {
        if (
          time === member.statusUpdatedAt.getTime() &&
          (body.state === undefined || body.state === member.state) &&
          (body.state === 'leaving' ||
            body.zoneId === undefined ||
            body.zoneId === member.zoneId)
        )
          return remember({
            userId,
            zoneId: member.zoneId,
            state: member.state,
            updatedAt: member.statusUpdatedAt,
          });
        throw new ConflictException({
          ...error('STATUS_STALE', '이전 상태입니다.'),
          current: {
            userId,
            zoneId: member.zoneId,
            state: member.state,
            updatedAt: member.statusUpdatedAt,
          },
        });
      }
      member.zoneId =
        body.state === 'leaving' ? null : (body.zoneId ?? member.zoneId);
      member.state = body.state ?? member.state;
      member.statusUpdatedAt = new Date(time);
      await repository.save(member);
      const response = {
        userId,
        zoneId: member.zoneId,
        state: member.state,
        updatedAt: member.statusUpdatedAt,
      };
      await this.socialNotifications.enqueueCrewStatus(manager, crew, userId);
      await this.liveActivity.enqueueCrewMembers(id, crew.festivalId, manager);
      return remember(response);
    });
  }

  async gather(id: string, userId: string, zoneId: string) {
    const { crew } = await this.member(id, userId);
    await this.active(crew);
    if (typeof zoneId !== 'string')
      throw new BadRequestException(
        error('VALIDATION', 'zoneId가 필요합니다.'),
      );
    await this.zone(crew.festivalId, zoneId);
    return this.crews.manager.transaction(async (manager: EntityManager) => {
      const locked = await this.lockedCrew(manager, id, userId);
      const remaining =
        (locked.lastGatherAt?.getTime() ?? 0) + GATHER_MS - Date.now();
      if (remaining > 0)
        throw new HttpException(
          {
            ...error('GATHER_COOLDOWN', '10분 뒤 다시 요청할 수 있습니다.'),
            retryAfter: Math.ceil(remaining / 1000),
          },
          429,
        );
      locked.lastGatherAt = new Date();
      await manager.getRepository(Crew).save(locked);
      const gather = manager
        .getRepository(CrewGather)
        .create({ id: randomUUID(), crewId: id, byUserId: userId, zoneId });
      const saved = await manager.getRepository(CrewGather).save(gather);
      await this.socialNotifications.enqueueCrewGather(
        manager,
        crew,
        userId,
        saved,
      );
      await this.liveActivity.enqueueCrewMembers(id, crew.festivalId, manager);
      return {
        zoneId: saved.zoneId,
        byUserId: saved.byUserId,
        at: saved.createdAt,
      };
    });
  }

  async rename(id: string, userId: string, value: unknown) {
    const { crew } = await this.member(id, userId);
    this.owner(crew, userId);
    await this.active(crew);
    const nextName = name(value, 20);
    const updated = await this.crews.manager.transaction(async (manager) => {
      const locked = await this.lockedCrew(manager, id, userId);
      this.owner(locked, userId);
      const changed = locked.name !== nextName;
      locked.name = nextName;
      const saved = await manager.getRepository(Crew).save(locked);
      if (changed)
        await this.liveActivity.enqueueCrewMembers(
          id,
          crew.festivalId,
          manager,
        );
      return saved;
    });
    return this.display(updated, userId);
  }

  async renameMember(id: string, userId: string, value: unknown) {
    const { crew } = await this.member(id, userId);
    await this.active(crew);
    const nickname = name(value, 12);
    await this.crews.manager.transaction(async (manager) => {
      await this.lockedCrew(manager, id, userId);
      await manager
        .getRepository(CrewMember)
        .update({ crewId: id, userId }, { nickname });
    });
    return { userId, nickname };
  }

  async removeMember(id: string, callerId: string, userId: string) {
    const { crew } = await this.member(id, callerId);
    await this.active(crew);
    await this.crews.manager.transaction(async (manager) => {
      const locked = await this.lockedCrew(manager, id, callerId);
      if (callerId !== userId) this.owner(locked, callerId);
      if (locked.ownerId === userId)
        throw new ConflictException(
          error(
            'OWNER_CANNOT_LEAVE',
            '크루장은 양도하거나 크루를 삭제해야 합니다.',
          ),
        );
      const members = manager.getRepository(CrewMember);
      const target = await members.findOne({ where: { crewId: id, userId } });
      if (!target)
        throw new NotFoundException(
          error('NOT_FOUND', '멤버를 찾을 수 없습니다.'),
        );
      await members.delete({ crewId: id, userId });
      await this.liveActivity.enqueueCrewMembers(id, crew.festivalId, manager);
      await this.liveActivity.enqueueUser(userId, crew.festivalId, manager);
    });
  }

  async transfer(id: string, callerId: string, toUserId: string) {
    const { crew } = await this.member(id, callerId);
    this.owner(crew, callerId);
    await this.active(crew);
    const updated = await this.crews.manager.transaction(async (manager) => {
      const locked = await this.lockedCrew(manager, id, callerId);
      this.owner(locked, callerId);
      if (
        toUserId === callerId ||
        !(await manager
          .getRepository(CrewMember)
          .findOne({ where: { crewId: id, userId: toUserId } }))
      )
        throw new BadRequestException(
          error('VALIDATION', '양도 대상은 다른 크루 멤버여야 합니다.'),
        );
      locked.ownerId = toUserId;
      return manager.getRepository(Crew).save(locked);
    });
    return this.display(updated, callerId);
  }

  async dissolve(id: string, callerId: string) {
    const { crew } = await this.member(id, callerId);
    this.owner(crew, callerId);
    await this.active(crew);
    await this.crews.manager.transaction(async (manager) => {
      const locked = await this.lockedCrew(manager, id, callerId);
      this.owner(locked, callerId);
      await this.socialNotifications.enqueueCrewDissolved(
        manager,
        locked,
        callerId,
      );
      await this.liveActivity.enqueueCrewMembers(id, crew.festivalId, manager);
      await manager.getRepository(Crew).delete({ id });
    });
  }
}
