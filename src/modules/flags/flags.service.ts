import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'crypto';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { AdminAuditService } from '../admin/audit/admin-audit.service';
import { User } from '../auth/entity/user.entity';
import {
  ImageStorageService,
  prepareFlagPhoto,
} from '../storage/image-storage.service';
import {
  Flag,
  FlagBearer,
  FlagBearerCode,
  FlagClaimAttempt,
  FlagFollow,
  FlagIdempotency,
  FlagPin,
  FlagReport,
  FlagStatusEvent,
} from './flag.entity';
import {
  bearerStatusView,
  forcedStatus,
  isRecord,
  nextStatus,
  repeatsAppliedStatus,
  statusView,
  validateAdminFlagInput,
  validateProfilePatch,
} from './flag-rules';
import {
  FlagClaimContext,
  FlagClaimThrottleService,
} from './flag-claim-throttle.service';
import { FlagPackSyncService } from './flag-pack-sync.service';
import { SocialNotificationService } from '../notification/social-notification.service';
import { LiveActivityService } from '../notification/live-activity.service';

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 깃발 하나의 기수 한도: 원래 기수 1명 + 공동 기수 3명(Figma S10 "공동 기수 초대 0 / 3명"). */
export const MAX_FLAG_BEARERS = 4;
const coBearerFullMessage = '공동 기수는 원래 기수를 빼고 최대 3명입니다.';
function newCode(): string {
  return Array.from(
    randomBytes(6),
    (byte) => codeAlphabet[byte % codeAlphabet.length],
  ).join('');
}
function fail(
  code: string,
  status: number,
  message: string,
  extra?: object,
): never {
  throw new HttpException({ code, message, ...extra }, status);
}

@Injectable()
export class FlagsService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    @InjectRepository(Flag) private readonly flags: Repository<Flag>,
    @InjectRepository(FlagFollow)
    private readonly follows: Repository<FlagFollow>,
    @InjectRepository(FlagPin) private readonly pins: Repository<FlagPin>,
    @InjectRepository(FlagBearer)
    private readonly bearers: Repository<FlagBearer>,
    @InjectRepository(FlagBearerCode)
    private readonly codes: Repository<FlagBearerCode>,
    @InjectRepository(FlagClaimAttempt)
    private readonly attempts: Repository<FlagClaimAttempt>,
    private readonly claimThrottle: FlagClaimThrottleService,
    @InjectRepository(FlagReport)
    private readonly reports: Repository<FlagReport>,
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly images: ImageStorageService,
    private readonly packSync: FlagPackSyncService,
    private readonly adminAudit: AdminAuditService,
    private readonly socialNotifications: SocialNotificationService,
    private readonly liveActivity: LiveActivityService,
  ) {}

  private codeKey(): Buffer {
    const secret = this.config.get<string>('auth.jwt.refreshSecret');
    if (!secret)
      throw new Error('JWT refresh secret is required for bearer codes');
    // Refresh secret rotation makes existing encrypted codes unreadable; migrate/reissue codes before rotation.
    return createHmac('sha256', secret)
      .update('festicore:flag-bearer-code:v1')
      .digest();
  }

  private hashCode(code: string): string {
    return createHmac('sha256', this.codeKey())
      .update('lookup:')
      .update(code)
      .digest('hex');
  }

  private encryptCode(code: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.codeKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(code, 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      'base64',
    );
  }

  private decryptCode(value: string): string {
    const data = Buffer.from(value, 'base64');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.codeKey(),
      data.subarray(0, 12),
    );
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString('utf8');
  }

  private photoUrl(id: string, size: 'photo' | 'thumbnail'): string {
    return `/api/v1/flags/${encodeURIComponent(id)}/${size}`;
  }

  async uploadPhoto(
    id: string,
    userId: string,
    file: { buffer: Buffer; mimetype: string } | undefined,
  ) {
    const flag = await this.bearerFlag(id, userId);
    if (!file?.buffer)
      throw new BadRequestException('photo 파일이 필요합니다.');
    const processed = await prepareFlagPhoto(file.buffer, file.mimetype);
    const saved = await this.images.saveFlagPhoto(id, processed);
    try {
      const result = await this.flags.update(
        { id, photoKey: flag.photoKey === null ? IsNull() : flag.photoKey },
        { photoKey: saved.photoKey, thumbKey: saved.thumbKey },
      );
      if (!result.affected)
        throw new ConflictException('사진이 동시에 변경됐습니다.');
    } catch (error) {
      await Promise.allSettled([
        this.images.delete(saved.photoKey),
        this.images.delete(saved.thumbKey),
      ]);
      throw error;
    }
    await Promise.allSettled([
      this.images.delete(flag.photoKey),
      this.images.delete(flag.thumbKey),
    ]);
    await this.packSync.sync(id);
    return {
      photoUrl: this.photoUrl(id, 'photo'),
      thumbUrl: this.photoUrl(id, 'thumbnail'),
    };
  }

  async readPhoto(id: string, size: 'photo' | 'thumbnail'): Promise<Buffer> {
    const flag = await this.publicFlag(id);
    const festival = await this.festivals.findOne({
      where: { id: flag.festivalId },
    });
    if (flag.hidden || !festival?.published)
      throw new NotFoundException('사진을 찾을 수 없습니다.');
    const key = size === 'photo' ? flag.photoKey : flag.thumbKey;
    if (!key) throw new NotFoundException('사진을 찾을 수 없습니다.');
    return this.images.readFlagPhoto(id, key);
  }

  private async replay(
    manager: EntityManager,
    userId: string,
    key: string,
    operation: string,
    input: unknown,
  ): Promise<Record<string, unknown> | null> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [userId, key],
    );
    const row = await manager
      .getRepository(FlagIdempotency)
      .findOne({ where: { userId, key } });
    if (!row || row.expiresAt <= new Date()) return null;
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    if (row.operation !== operation || row.requestHash !== hash)
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '같은 키로 다른 요청을 보냈습니다.',
      });
    return row.response;
  }

  private async remember(
    manager: EntityManager,
    userId: string,
    key: string,
    operation: string,
    input: unknown,
    response: Record<string, unknown>,
  ) {
    const rows = manager.getRepository(FlagIdempotency);
    const existing = await rows.findOne({ where: { userId, key } });
    await rows.save(
      rows.create({
        id: existing?.id,
        userId,
        key,
        operation,
        requestHash: createHash('sha256')
          .update(JSON.stringify(input))
          .digest('hex'),
        response,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      }),
    );
  }

  private async publicFlag(id: string): Promise<Flag> {
    const flag = await this.flags.findOne({
      where: { id, visibility: 'public' },
    });
    const festival = flag
      ? await this.festivals.findOne({ where: { id: flag.festivalId } })
      : null;
    if (!flag || !festival?.published)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: '깃발을 찾을 수 없습니다.',
      });
    return flag;
  }

  private async bearerFlag(id: string, userId: string): Promise<Flag> {
    const flag = await this.publicFlag(id);
    const bearer = await this.bearers.findOne({
      where: { flagId: id, userId },
    });
    if (!bearer)
      throw new ForbiddenException({
        code: 'FLAG_NOT_BEARER',
        message: '기수 권한이 없습니다.',
      });
    return flag;
  }

  /** 깃발 프로필. 비공개 계획은 공개 응답에서 가리고 기수 본인 응답에는 그대로 보낸다. */
  private profile(flag: Flag, viewer: 'public' | 'bearer' = 'public') {
    return {
      id: flag.id,
      name: flag.name,
      thumbUrl: flag.thumbKey
        ? this.photoUrl(flag.id, 'thumbnail')
        : flag.thumbUrl,
      photoUrl: flag.photoKey ? this.photoUrl(flag.id, 'photo') : flag.photoUrl,
      tags: flag.tags,
      bio: flag.bio,
      followerCount: flag.followerCount,
      planVisible: flag.planVisible,
      plan: viewer === 'bearer' || flag.planVisible ? flag.plan : [],
      homeZoneId: flag.homeZoneId,
    };
  }

  async detail(id: string, userId?: string) {
    const flag = await this.publicFlag(id);
    const bearer = userId
      ? await this.bearers.exists({ where: { flagId: id, userId } })
      : false;
    if (flag.hidden && !bearer)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: '깃발을 찾을 수 없습니다.',
      });
    const follow = userId
      ? await this.follows.exists({ where: { flagId: id, userId } })
      : null;
    // 앱 상세의 "잠금화면에 표시" 토글이 현재 대표 깃발인지 읽는다.
    const pinned = userId
      ? await this.pins.exists({ where: { userId, flagId: id } })
      : null;
    return {
      ...this.profile(flag),
      status: statusView(flag),
      isFollowing: follow,
      isBearer: userId ? bearer : null,
      isPinned: pinned,
      hidden: flag.hidden,
    };
  }

  // 탈퇴도 사용자 행을 먼저 잠근다. JWT 검사 직후 탈퇴가 시작된 요청을 여기서 거른다.
  private async lockActiveUser(manager: EntityManager, userId: string) {
    const rows = await manager.query<{ id: string }[]>(
      `SELECT "id" FROM "users" WHERE "id" = $1 FOR UPDATE`,
      [userId],
    );
    if (!rows.length) throw new UnauthorizedException('탈퇴한 사용자입니다.');
  }

  async follow(id: string, userId: string, key: string) {
    const flag = await this.publicFlag(id);
    if (flag.hidden)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: '깃발을 찾을 수 없습니다.',
      });
    return this.db.transaction(async (manager) => {
      await this.lockActiveUser(manager, userId);
      const prior = await this.replay(manager, userId, key, `follow:${id}`, {});
      if (prior) return prior;
      const flags = manager.getRepository(Flag);
      const follows = manager.getRepository(FlagFollow);
      const pins = manager.getRepository(FlagPin);
      const locked = await flags
        .createQueryBuilder('flag')
        .setLock('pessimistic_write')
        .where('flag.id = :id', { id })
        .getOne();
      if (!locked || locked.hidden)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: '깃발을 찾을 수 없습니다.',
        });
      const existing = await follows.findOne({ where: { flagId: id, userId } });
      if (!existing) {
        if ((await follows.count({ where: { userId } })) >= 100)
          throw new ConflictException({
            code: 'FOLLOW_LIMIT',
            message: '팔로우는 최대 100개입니다.',
          });
        await follows.save(
          follows.create({ flagId: id, festivalId: locked.festivalId, userId }),
        );
        locked.followerCount += 1;
        await flags.save(locked);
        const pin = await pins.findOne({ where: { userId } });
        if (!pin?.flagId) await pins.save(pins.create({ userId, flagId: id }));
        await this.liveActivity.enqueueUser(userId, undefined, manager);
      }
      const response = {
        flagId: id,
        following: true,
        followerCount: locked.followerCount,
      };
      await this.remember(manager, userId, key, `follow:${id}`, {}, response);
      return response;
    });
  }

  async unfollow(id: string, userId: string) {
    await this.publicFlag(id);
    return this.db.transaction(async (manager) => {
      await this.lockActiveUser(manager, userId);
      const flags = manager.getRepository(Flag);
      const follows = manager.getRepository(FlagFollow);
      const pins = manager.getRepository(FlagPin);
      const flag = await flags
        .createQueryBuilder('flag')
        .setLock('pessimistic_write')
        .where('flag.id = :id', { id })
        .getOne();
      if (!flag) throw new NotFoundException({ code: 'NOT_FOUND' });
      const deleted = await follows.delete({ flagId: id, userId });
      if (deleted.affected) {
        flag.followerCount = Math.max(0, flag.followerCount - 1);
        await flags.save(flag);
      }
      const pin = await pins.findOne({ where: { userId } });
      if (pin?.flagId === id) {
        const latest = await follows.findOne({
          where: { userId },
          order: { followedAt: 'DESC' },
        });
        pin.flagId = latest?.flagId ?? null;
        await pins.save(pin);
      }
      if (deleted.affected)
        await this.liveActivity.enqueueUser(userId, undefined, manager);
      return {
        flagId: id,
        following: false,
        followerCount: flag.followerCount,
      };
    });
  }

  async myFollows(userId: string, festivalId?: string) {
    const rows = await this.follows.find({
      where: festivalId ? { userId, festivalId } : { userId },
      order: { followedAt: 'DESC' },
    });
    return {
      items: rows.map((row) => ({
        flagId: row.flagId,
        festivalId: row.festivalId,
        followedAt: row.followedAt.toISOString(),
      })),
    };
  }

  async pin(userId: string, input: unknown) {
    if (
      !isRecord(input) ||
      !Object.hasOwn(input, 'flagId') ||
      (input.flagId !== null && typeof input.flagId !== 'string')
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'flagId 문자열 또는 null이 필요합니다.',
      });
    const flagId = input.flagId;
    return this.db.transaction(async (manager) => {
      await this.lockActiveUser(manager, userId);
      const follows = manager.getRepository(FlagFollow);
      if (flagId && !(await follows.exists({ where: { userId, flagId } })))
        throw new ConflictException({
          code: 'PIN_NOT_FOLLOWING',
          message: '팔로우한 깃발만 핀할 수 있습니다.',
        });
      const pins = manager.getRepository(FlagPin);
      const previous = await pins.findOne({ where: { userId } });
      if ((previous?.flagId ?? null) !== flagId) {
        await pins.save(pins.create({ userId, flagId }));
        await this.liveActivity.enqueueUser(userId, undefined, manager);
      }
      return { pinnedFlagId: flagId };
    });
  }

  async report(id: string, userId: string, input: unknown) {
    const flag = await this.publicFlag(id);
    if (flag.hidden) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (
      !isRecord(input) ||
      !['fake', 'inappropriate', 'other'].includes(input.reason as string) ||
      (input.note !== undefined &&
        (typeof input.note !== 'string' || [...input.note].length > 200))
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message: '신고 사유가 올바르지 않습니다.',
      });
    return this.db.transaction(async (manager) => {
      await this.lockActiveUser(manager, userId);
      const flags = manager.getRepository(Flag);
      const reports = manager.getRepository(FlagReport);
      const locked = await flags
        .createQueryBuilder('flag')
        .setLock('pessimistic_write')
        .where('flag.id = :id', { id })
        .getOne();
      if (!locked || locked.hidden)
        throw new NotFoundException({ code: 'NOT_FOUND' });
      if (await reports.exists({ where: { flagId: id, userId } }))
        throw new ConflictException({
          code: 'ALREADY_REPORTED',
          message: '이미 신고했습니다.',
        });
      const row = await reports.save(
        reports.create({
          flagId: id,
          userId,
          reason: input.reason as FlagReport['reason'],
          note: (input.note as string | undefined) ?? null,
        }),
      );
      locked.reportCount += 1;
      if (locked.reportCount >= 3) locked.hidden = true;
      await flags.save(locked);
      if (locked.hidden)
        await this.liveActivity.enqueueFestival(locked.festivalId, manager);
      return { reportId: row.id };
    });
  }

  async claim(userId: string, input: unknown, context: FlagClaimContext) {
    if (
      !isRecord(input) ||
      typeof input.code !== 'string' ||
      !/^[A-HJ-NP-Z2-9]{6}$/i.test(input.code) ||
      typeof input.festivalId !== 'string'
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message: '6자리 코드와 festivalId가 필요합니다.',
      });
    const festival = await this.festivals.findOne({
      where: { id: input.festivalId },
    });
    if (!festival?.published)
      throw new NotFoundException({ code: 'NOT_FOUND' });
    const hash = this.hashCode(input.code.toUpperCase());
    const festivalId = input.festivalId;
    // Serialize the lookup and failure recording across user, device, IP and candidate code.
    // Returning an error value keeps the failed-attempt writes committed before throwing.
    const gate = await this.db.transaction(async (manager) => {
      const lockKeys = [
        `user:${userId}`,
        `device:${context.deviceId.toLowerCase()}`,
        `ip:${context.ip}`,
        `code:${hash}`,
      ]
        .map((value) => `${festivalId}:${value}`)
        .sort();
      for (const key of lockKeys)
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          key,
        ]);
      const now = new Date();
      const sharedRetryAfter = await this.claimThrottle.locked(
        festivalId,
        userId,
        hash,
        context,
        now,
        manager,
      );
      if (sharedRetryAfter > 0)
        return { code: 'BEARER_CODE_LOCKED', retryAfter: sharedRetryAfter };
      const attempts = manager.getRepository(FlagClaimAttempt);
      const attempt = await attempts.findOne({ where: { userId } });
      if (attempt?.lockedUntil && attempt.lockedUntil > now)
        return {
          code: 'BEARER_CODE_LOCKED',
          retryAfter: Math.ceil(
            (attempt.lockedUntil.getTime() - now.getTime()) / 1000,
          ),
        };
      const code = await manager.getRepository(FlagBearerCode).findOne({
        where: { codeHash: hash, festivalId },
      });
      if (
        code &&
        code.expiresAt > now &&
        (!code.usedBy || code.usedBy === userId)
      ) {
        await attempts.delete({ userId });
        return null;
      }
      const shared = await this.claimThrottle.failed(
        festivalId,
        userId,
        hash,
        context,
        now,
        manager,
      );
      const within =
        attempt?.firstFailedAt &&
        now.getTime() - attempt.firstFailedAt.getTime() < 10 * 60_000;
      const failures = (within ? attempt.failures : 0) + 1;
      await attempts.save(
        attempts.create({
          userId,
          failures,
          firstFailedAt: within ? attempt.firstFailedAt : now,
          lockedUntil:
            failures >= 3 ? new Date(now.getTime() + 10 * 60_000) : null,
        }),
      );
      return failures >= 3 || shared.retryAfter > 0
        ? {
            code: 'BEARER_CODE_LOCKED',
            retryAfter: Math.max(600, shared.retryAfter),
          }
        : {
            code: 'BEARER_CODE_INVALID',
            remainingAttempts: Math.min(3 - failures, shared.remainingAttempts),
          };
    });
    if (gate?.code === 'BEARER_CODE_LOCKED')
      fail('BEARER_CODE_LOCKED', 423, '코드 입력이 잠겼습니다.', {
        retryAfter: gate.retryAfter,
      });
    if (gate?.code === 'BEARER_CODE_INVALID')
      fail('BEARER_CODE_INVALID', 422, '유효하지 않은 코드입니다.', {
        remainingAttempts: gate.remainingAttempts,
      });
    const now = new Date();
    const claimed = await this.db.transaction(async (manager) => {
      const codes = manager.getRepository(FlagBearerCode);
      const flags = manager.getRepository(Flag);
      const bearers = manager.getRepository(FlagBearer);
      const lockedCode = await codes
        .createQueryBuilder('code')
        .setLock('pessimistic_write')
        .where('code.codeHash = :hash', { hash })
        .getOne();
      if (
        !lockedCode ||
        lockedCode.expiresAt <= now ||
        (lockedCode.usedBy && lockedCode.usedBy !== userId)
      )
        fail('BEARER_CODE_INVALID', 422, '유효하지 않은 코드입니다.');
      let flag = lockedCode.flagId
        ? await flags.findOne({ where: { id: lockedCode.flagId } })
        : null;
      if (
        flag &&
        (await bearers.exists({ where: { flagId: flag.id, userId } }))
      )
        return {
          flagId: flag.id,
          flag: this.profile(flag, 'bearer'),
          isNew: false,
          coBearers: (await bearers.find({ where: { flagId: flag.id } })).map(
            (b) => b.userId,
          ),
        };
      const owned = await flags
        .createQueryBuilder('flag')
        .innerJoin(FlagBearer, 'bearer', 'bearer.flagId = flag.id')
        .where('flag.festivalId = :festivalId AND bearer.userId = :userId', {
          festivalId: lockedCode.festivalId,
          userId,
        })
        .getOne();
      if (owned)
        throw new ConflictException({
          code: 'BEARER_LIMIT',
          message: '페스티벌당 한 깃발만 맡을 수 있습니다.',
        });
      if (!flag) {
        flag = flags.create({
          id: `flg_${randomBytes(5).toString('hex')}`,
          festivalId: lockedCode.festivalId,
          name: `새 깃발 ${randomBytes(3).toString('hex')}`,
          visibility: 'public',
          tags: ['newbie'],
          plan: [],
          planVisible: true,
          followerCount: 0,
          status: 'scheduled',
          activity: null,
          zoneId: null,
          homeZoneId: null,
          photoUrl: null,
          thumbUrl: null,
          bio: null,
          hidden: false,
          reportCount: 0,
          ownerId: userId,
          restartDate: null,
          statusUpdatedAt: null,
          statusUpdatedBy: null,
          statusClientAt: null,
        });
        flag = await flags.save(flag);
        lockedCode.flagId = flag.id;
      } else if (
        (await bearers.count({ where: { flagId: flag.id } })) >=
        MAX_FLAG_BEARERS
      )
        throw new ConflictException({
          code: 'CO_BEARER_FULL',
          message: coBearerFullMessage,
        });
      await bearers.save(
        bearers.create({
          flagId: flag.id,
          festivalId: flag.festivalId,
          userId,
          isOwner: flag.ownerId === userId,
        }),
      );
      lockedCode.usedBy = userId;
      lockedCode.usedAt = now;
      await codes.save(lockedCode);
      return {
        flagId: flag.id,
        flag: this.profile(flag, 'bearer'),
        isNew: flag.ownerId === userId,
        coBearers: (await bearers.find({ where: { flagId: flag.id } })).map(
          (b) => b.userId,
        ),
      };
    });
    await this.packSync.sync(claimed.flagId);
    return claimed;
  }

  async bearerView(id: string, userId: string) {
    const flag = await this.bearerFlag(id, userId);
    const bearers = await this.bearers.find({ where: { flagId: id } });
    const userIds = new Set(bearers.map((b) => b.userId));
    if (flag.statusUpdatedBy) userIds.add(flag.statusUpdatedBy);
    const users = await this.users.findByIds([...userIds]);
    const names = new Map(users.map((user) => [user.id, user.nickname]));
    return {
      flag: this.profile(flag, 'bearer'),
      status: bearerStatusView(
        flag,
        flag.statusUpdatedBy ? names.get(flag.statusUpdatedBy) : undefined,
      ),
      planVisible: flag.planVisible,
      followerCount: flag.followerCount,
      coBearers: bearers.map((b) => ({
        userId: b.userId,
        nickname: names.get(b.userId) ?? '',
      })),
      hidden: flag.hidden,
      reportCount: flag.reportCount,
      restartUsedToday:
        flag.restartDate ===
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(
          new Date(),
        ),
    };
  }

  async patch(id: string, userId: string, input: unknown) {
    const flag = await this.bearerFlag(id, userId);
    const patch = validateProfilePatch(input);
    const festival = await this.festivals.findOne({
      where: { id: flag.festivalId },
    });
    if (!festival?.published)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: '공개된 페스티벌이 없습니다.',
      });
    const pack = festival.published;
    if (
      patch.homeZoneId !== undefined &&
      patch.homeZoneId !== null &&
      !(
        Array.isArray(pack.zones) &&
        pack.zones.some(
          (zone) => isRecord(zone) && zone.id === patch.homeZoneId,
        )
      )
    )
      fail('ZONE_NOT_FOUND', 404, '존을 찾을 수 없습니다.');
    const sets = Array.isArray(pack.sets) ? pack.sets : [];
    if (
      patch.plan !== undefined &&
      !(patch.plan as string[]).every((id) =>
        sets.some((set: unknown) => isRecord(set) && set.id === id),
      )
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'plan에 없는 셋이 포함되었습니다.',
      });
    if (
      patch.name &&
      (await this.flags.exists({
        where: { festivalId: flag.festivalId, name: patch.name as string },
      })) &&
      patch.name !== flag.name
    )
      throw new ConflictException({
        code: 'FLAG_NAME_TAKEN',
        message: '이미 사용 중인 깃발 이름입니다.',
      });
    if (Object.keys(patch).length) await this.flags.update({ id }, patch);
    await this.packSync.sync(id);
    const current = await this.bearerFlag(id, userId);
    return this.profile(current, 'bearer');
  }

  async status(id: string, userId: string, key: string, input: unknown) {
    await this.bearerFlag(id, userId);
    return this.db.transaction(async (manager) => {
      const prior = await this.replay(
        manager,
        userId,
        key,
        `status:${id}`,
        input,
      );
      if (prior) return prior;
      const flags = manager.getRepository(Flag);
      const flag = await flags
        .createQueryBuilder('flag')
        .setLock('pessimistic_write')
        .where('flag.id = :id', { id })
        .getOne();
      if (!flag) throw new NotFoundException({ code: 'NOT_FOUND' });
      if (repeatsAppliedStatus(flag, input)) {
        const author = flag.statusUpdatedBy
          ? await manager
              .getRepository(User)
              .findOne({ where: { id: flag.statusUpdatedBy } })
          : null;
        const repeated = bearerStatusView(flag, author?.nickname);
        await this.remember(
          manager,
          userId,
          key,
          `status:${id}`,
          input,
          repeated,
        );
        return repeated;
      }
      const next = nextStatus(flag, input);
      if (next.zoneId) {
        const festival = await manager
          .getRepository(AdminFestival)
          .findOne({ where: { id: flag.festivalId } });
        if (
          !Array.isArray(festival?.published?.zones) ||
          !festival.published.zones.some(
            (zone) => isRecord(zone) && zone.id === next.zoneId,
          )
        )
          fail('ZONE_NOT_FOUND', 404, '존을 찾을 수 없습니다.');
      }
      const since = new Date(Date.now() - 60_000);
      if (
        (await manager
          .getRepository(FlagStatusEvent)
          .createQueryBuilder('event')
          .where('event.flagId = :id AND event.createdAt >= :since', {
            id,
            since,
          })
          .getCount()) >= 12
      )
        throw new HttpException(
          {
            code: 'RATE_LIMITED',
            message: '분당 12회까지 업데이트할 수 있습니다.',
          },
          429,
        );
      Object.assign(flag, next, {
        statusUpdatedAt: new Date(),
        statusUpdatedBy: userId,
      });
      await flags.save(flag);
      await manager.getRepository(FlagStatusEvent).save({
        flagId: id,
        userId,
        status: flag.status,
        zoneId: flag.zoneId,
        activity: flag.activity,
      });
      await this.socialNotifications.enqueueFlagStatus(manager, flag, userId);
      await this.liveActivity.enqueueFestival(flag.festivalId, manager);
      const author = await manager
        .getRepository(User)
        .findOne({ where: { id: userId } });
      const response = bearerStatusView(flag, author?.nickname);
      await this.remember(
        manager,
        userId,
        key,
        `status:${id}`,
        input,
        response,
      );
      return response;
    });
  }

  async forceStatus(
    id: string,
    actor: string | null,
    input: unknown,
  ): Promise<ReturnType<typeof statusView>> {
    const next = forcedStatus(input);
    return this.db.transaction(async (manager) => {
      const flags = manager.getRepository(Flag);
      const flag = await flags
        .createQueryBuilder('flag')
        .setLock('pessimistic_write')
        .where('flag.id = :id', { id })
        .getOne();
      if (!flag) throw new NotFoundException({ code: 'NOT_FOUND' });
      if (next.zoneId) {
        const festival = await manager.getRepository(AdminFestival).findOne({
          where: { id: flag.festivalId },
        });
        if (
          !Array.isArray(festival?.published?.zones) ||
          !festival.published.zones.some(
            (zone) => isRecord(zone) && zone.id === next.zoneId,
          )
        ) {
          fail('ZONE_NOT_FOUND', 404, '존을 찾을 수 없습니다.');
        }
      }
      const before = statusView(flag);
      // 관리자 변경보다 먼저 누른 기수 변경은 오래된 변경으로 막는다. 기준값은 낮추지 않는다.
      const forcedAt = new Date();
      Object.assign(flag, next, {
        statusUpdatedAt: forcedAt,
        statusUpdatedBy: null,
        statusClientAt: new Date(
          Math.max(forcedAt.getTime(), flag.statusClientAt?.getTime() ?? 0),
        ),
      });
      await flags.save(flag);
      await manager.getRepository(FlagStatusEvent).save({
        flagId: id,
        userId: null,
        status: flag.status,
        zoneId: flag.zoneId,
        activity: flag.activity,
      });
      const after = statusView(flag);
      await this.adminAudit.record(manager, {
        actor,
        action: 'flag.force-status',
        target: `flag:${id}`,
        before,
        after,
      });
      await this.liveActivity.enqueueFestival(flag.festivalId, manager);
      return after;
    });
  }

  async invite(id: string, userId: string) {
    const flag = await this.bearerFlag(id, userId);
    if (flag.ownerId !== userId)
      throw new ForbiddenException({
        code: 'FLAG_NOT_OWNER',
        message: '원래 기수만 초대할 수 있습니다.',
      });
    if (
      (await this.bearers.count({ where: { flagId: id } })) >= MAX_FLAG_BEARERS
    )
      throw new ConflictException({
        code: 'CO_BEARER_FULL',
        message: coBearerFullMessage,
      });
    const code = newCode();
    const expiresAt = new Date(Date.now() + 24 * 3600_000);
    await this.codes.save(
      this.codes.create({
        codeHash: this.hashCode(code),
        codeCiphertext: this.encryptCode(code),
        festivalId: flag.festivalId,
        flagId: id,
        label: null,
        expiresAt,
        usedBy: null,
        usedAt: null,
      }),
    );
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async removeBearer(id: string, actorId: string, targetId: string) {
    await this.publicFlag(id);
    await this.db.transaction(async (manager) => {
      const flag = await manager.getRepository(Flag).findOne({
        where: { id, visibility: 'public' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!flag)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: '깃발을 찾을 수 없습니다.',
        });
      const bearers = manager.getRepository(FlagBearer);
      if (!(await bearers.exists({ where: { flagId: id, userId: actorId } })))
        throw new ForbiddenException({
          code: 'FLAG_NOT_BEARER',
          message: '기수 권한이 없습니다.',
        });
      if (actorId !== targetId && flag.ownerId !== actorId)
        throw new ForbiddenException({
          code: 'FLAG_NOT_OWNER',
          message: '원래 기수만 제거할 수 있습니다.',
        });
      if (targetId === flag.ownerId)
        throw new ConflictException({
          code: 'FLAG_OWNER_REQUIRED',
          message: '원래 기수는 제거할 수 없습니다.',
        });
      await bearers.delete({ flagId: id, userId: targetId });
    });
  }

  async createCodes(festivalId: string, input: unknown, actor: string) {
    if (
      !isRecord(input) ||
      !Number.isInteger(input.count) ||
      (input.count as number) < 1 ||
      (input.count as number) > 100 ||
      (input.label !== undefined &&
        (typeof input.label !== 'string' || input.label.length > 100))
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'count는 1..100이어야 합니다.',
      });
    if (!(await this.festivals.exists({ where: { id: festivalId } })))
      throw new NotFoundException({ code: 'NOT_FOUND' });
    const expiresAt = new Date(Date.now() + 30 * 86_400_000);
    const label = typeof input.label === 'string' ? input.label : null;
    return this.db.transaction(async (manager) => {
      const codes = manager.getRepository(FlagBearerCode);
      const result: { code: string; expiresAt: string }[] = [];
      for (let i = 0; i < (input.count as number); i++) {
        const code = newCode();
        await codes.save(
          codes.create({
            codeHash: this.hashCode(code),
            codeCiphertext: this.encryptCode(code),
            festivalId,
            flagId: null,
            label,
            expiresAt,
            usedBy: null,
            usedAt: null,
          }),
        );
        result.push({ code, expiresAt: expiresAt.toISOString() });
      }
      await this.adminAudit.record(manager, {
        actor,
        action: 'flag.bearer-codes.created',
        target: `festival:${festivalId}`,
        before: null,
        after: {
          count: result.length,
          label,
          expiresAt: expiresAt.toISOString(),
        },
      });
      return { codes: result };
    });
  }

  async listCodes(festivalId: string) {
    const rows = await this.codes.find({ where: { festivalId } });
    return {
      items: rows.map((row) => ({
        code: this.decryptCode(row.codeCiphertext),
        label: row.label,
        status: row.usedBy
          ? 'used'
          : row.expiresAt <= new Date()
            ? 'expired'
            : 'unused',
        usedBy: row.usedBy,
        flagId: row.flagId,
      })),
    };
  }

  async reported(festivalId?: string, minReports = 3) {
    if (!Number.isInteger(minReports) || minReports < 1)
      throw new BadRequestException({ code: 'VALIDATION' });
    const rows = await this.flags
      .createQueryBuilder('flag')
      .where('flag.reportCount >= :minReports', { minReports })
      .andWhere(festivalId ? 'flag.festivalId = :festivalId' : '1=1', {
        festivalId,
      })
      .getMany();
    return {
      items: await Promise.all(
        rows.map(async (flag) => ({
          flag: this.profile(flag),
          hidden: flag.hidden,
          reports: (
            await this.reports.find({ where: { flagId: flag.id } })
          ).map((row) => ({
            reason: row.reason,
            note: row.note,
            at: row.createdAt.toISOString(),
          })),
        })),
      ),
    };
  }

  async setHidden(id: string, hidden: boolean, actor: string) {
    const changedFestivals = await this.db.transaction(async (manager) => {
      const repo = manager.getRepository(Flag);
      const flag = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!flag) throw new NotFoundException({ code: 'NOT_FOUND' });
      const before = { hidden: flag.hidden };
      flag.hidden = hidden;
      await repo.save(flag);
      if (before.hidden !== hidden)
        await this.liveActivity.enqueueFestival(flag.festivalId, manager);
      await this.adminAudit.record(manager, {
        actor,
        action: hidden ? 'flag.hidden' : 'flag.unhidden',
        target: `flag:${id}`,
        before,
        after: { hidden },
      });
      return this.packSync.sync(id, manager);
    });
    if (changedFestivals.length)
      await this.packSync.invalidatePacks(changedFestivals);
    return { flagId: id, hidden };
  }

  async adminFlags(festivalId: string) {
    const flags = await this.flags.find({
      where: { festivalId },
      order: { name: 'ASC' },
    });
    return {
      items: flags.map((flag) => this.adminFlagView(flag)),
    };
  }

  /** 관리자 화면용 깃발. 계획 비공개여도 전체 계획을 보여 준다. */
  private adminFlagView(flag: Flag) {
    return {
      ...this.profile(flag),
      plan: flag.plan,
      visibility: flag.visibility,
      hidden: flag.hidden,
      reportCount: flag.reportCount,
      status: statusView(flag),
    };
  }

  /** 홈 존과 계획 셋이 축제 팩(발행본 우선, 없으면 초안)에 있는지 확인한다. */
  private assertPackReferences(
    festival: AdminFestival,
    patch: Record<string, unknown>,
  ) {
    const pack = festival.published ?? festival.draft;
    const zones = Array.isArray(pack?.zones) ? pack.zones : [];
    const sets = Array.isArray(pack?.sets) ? pack.sets : [];
    if (
      typeof patch.homeZoneId === 'string' &&
      !zones.some((zone) => isRecord(zone) && zone.id === patch.homeZoneId)
    )
      fail('ZONE_NOT_FOUND', 404, '존을 찾을 수 없습니다.');
    if (
      Array.isArray(patch.plan) &&
      !patch.plan.every((id) =>
        sets.some((set) => isRecord(set) && set.id === id),
      )
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'plan에 없는 셋이 포함되었습니다.',
      });
  }

  /** 관리자가 축제에 기수 없는 깃발을 만든다. 현장 상태는 예정으로 시작한다. */
  async adminCreate(festivalId: string, input: unknown, actor: string) {
    const fields = validateAdminFlagInput(input, 'create');
    const { flag, changed } = await this.db.transaction(async (manager) => {
      const festival = await manager.getRepository(AdminFestival).findOne({
        where: { id: festivalId },
      });
      if (!festival)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: '축제를 찾을 수 없습니다.',
        });
      this.assertPackReferences(festival, fields);
      const flags = manager.getRepository(Flag);
      if (
        await flags.exists({
          where: { festivalId, name: fields.name as string },
        })
      )
        throw new ConflictException({
          code: 'FLAG_NAME_TAKEN',
          message: '이미 사용 중인 깃발 이름입니다.',
        });
      const created = await flags.save(
        flags.create({
          id: `flg_${randomBytes(5).toString('hex')}`,
          festivalId,
          visibility: 'public',
          bio: null,
          plan: [],
          planVisible: true,
          homeZoneId: null,
          photoUrl: null,
          thumbUrl: null,
          ...fields,
          followerCount: 0,
          status: 'scheduled',
          activity: null,
          zoneId: null,
          hidden: false,
          reportCount: 0,
          ownerId: null,
          restartDate: null,
          statusUpdatedAt: null,
          statusUpdatedBy: null,
          statusClientAt: null,
        }),
      );
      await this.adminAudit.record(manager, {
        actor,
        action: 'flag.created',
        target: `flag:${created.id}`,
        before: null,
        after: this.adminFlagView(created),
      });
      return {
        flag: created,
        changed: await this.packSync.sync(created.id, manager),
      };
    });
    await this.packSync.invalidatePacks(changed);
    return this.adminFlagView(flag);
  }

  /** 관리자가 깃발 프로필·사진 URL·계획·계획 공개를 고친다. 바뀐 필드만 감사 기록한다. */
  async adminUpdate(id: string, input: unknown, actor: string) {
    const patch = validateAdminFlagInput(input, 'update');
    const { flag, changed } = await this.db.transaction(async (manager) => {
      const flags = manager.getRepository(Flag);
      const current = await flags.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: '깃발을 찾을 수 없습니다.',
        });
      const festival = await manager.getRepository(AdminFestival).findOne({
        where: { id: current.festivalId },
      });
      if (!festival)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: '축제를 찾을 수 없습니다.',
        });
      this.assertPackReferences(festival, patch);
      if (
        typeof patch.name === 'string' &&
        patch.name !== current.name &&
        (await flags.exists({
          where: { festivalId: current.festivalId, name: patch.name },
        }))
      )
        throw new ConflictException({
          code: 'FLAG_NAME_TAKEN',
          message: '이미 사용 중인 깃발 이름입니다.',
        });
      const keys = Object.keys(patch) as (keyof Flag)[];
      const before = Object.fromEntries(keys.map((key) => [key, current[key]]));
      Object.assign(current, patch);
      const saved = await flags.save(current);
      await this.adminAudit.record(manager, {
        actor,
        action: 'flag.updated',
        target: `flag:${id}`,
        before,
        after: Object.fromEntries(keys.map((key) => [key, saved[key]])),
      });
      return { flag: saved, changed: await this.packSync.sync(id, manager) };
    });
    await this.packSync.invalidatePacks(changed);
    return this.adminFlagView(flag);
  }

  async adminBearers(festivalId: string) {
    if (!(await this.festivals.exists({ where: { id: festivalId } })))
      throw new NotFoundException({ code: 'NOT_FOUND' });
    const bearers = await this.bearers.find({
      where: { festivalId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (!bearers.length) return { items: [] };
    const [flags, users] = await Promise.all([
      this.flags.find({
        where: { festivalId, id: In(bearers.map((bearer) => bearer.flagId)) },
      }),
      this.users.find({
        select: { id: true, nickname: true },
        where: { id: In(bearers.map((bearer) => bearer.userId)) },
      }),
    ]);
    const flagsById = new Map(flags.map((flag) => [flag.id, flag]));
    const usersById = new Map(users.map((user) => [user.id, user]));
    return {
      items: bearers.flatMap((bearer) => {
        const flag = flagsById.get(bearer.flagId);
        if (!flag) return [];
        return [
          {
            userId: bearer.userId,
            nickname: usersById.get(bearer.userId)?.nickname ?? null,
            flagId: flag.id,
            flagName: flag.name,
            isOwner: bearer.isOwner,
            joinedAt: bearer.createdAt.toISOString(),
            hidden: flag.hidden,
            status: flag.status,
          },
        ];
      }),
    };
  }
}
