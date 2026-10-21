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
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
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
  forcedStatus,
  isRecord,
  nextStatus,
  statusView,
  validateProfilePatch,
} from './flag-rules';
import {
  FlagClaimContext,
  FlagClaimThrottleService,
} from './flag-claim-throttle.service';
import { FlagPackSyncService } from './flag-pack-sync.service';

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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

  private profile(flag: Flag) {
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
      plan: flag.planVisible ? flag.plan : [],
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
    return {
      ...this.profile(flag),
      status: statusView(flag),
      isFollowing: follow,
      isBearer: userId ? bearer : null,
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
    if (flagId && !(await this.follows.exists({ where: { userId, flagId } })))
      throw new ConflictException({
        code: 'PIN_NOT_FOLLOWING',
        message: '팔로우한 깃발만 핀할 수 있습니다.',
      });
    await this.pins.save(this.pins.create({ userId, flagId }));
    return { pinnedFlagId: flagId };
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
          flag: this.profile(flag),
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
        });
        flag = await flags.save(flag);
        lockedCode.flagId = flag.id;
      } else if ((await bearers.count({ where: { flagId: flag.id } })) >= 3)
        throw new ConflictException({
          code: 'CO_BEARER_FULL',
          message: '공동 기수는 최대 3명입니다.',
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
        flag: this.profile(flag),
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
    const users = await this.users.findByIds(bearers.map((b) => b.userId));
    const names = new Map(users.map((user) => [user.id, user.nickname]));
    return {
      flag: this.profile(flag),
      status: statusView(flag),
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
    return this.profile(current);
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
      Object.assign(flag, next, { statusUpdatedAt: new Date() });
      await flags.save(flag);
      await manager.getRepository(FlagStatusEvent).save({
        flagId: id,
        userId,
        status: flag.status,
        zoneId: flag.zoneId,
        activity: flag.activity,
      });
      const response = statusView(flag);
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
      Object.assign(flag, next, { statusUpdatedAt: new Date() });
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
    if ((await this.bearers.count({ where: { flagId: id } })) >= 3)
      throw new ConflictException({
        code: 'CO_BEARER_FULL',
        message: '공동 기수는 최대 3명입니다.',
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
    await this.db.transaction(async (manager) => {
      const repo = manager.getRepository(Flag);
      const flag = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!flag) throw new NotFoundException({ code: 'NOT_FOUND' });
      const before = { hidden: flag.hidden };
      flag.hidden = hidden;
      await repo.save(flag);
      await this.adminAudit.record(manager, {
        actor,
        action: hidden ? 'flag.hidden' : 'flag.unhidden',
        target: `flag:${id}`,
        before,
        after: { hidden },
      });
      await this.packSync.sync(id, manager);
    });
    return { flagId: id, hidden };
  }

  async adminFlags(festivalId: string) {
    const flags = await this.flags.find({
      where: { festivalId },
      order: { name: 'ASC' },
    });
    return {
      items: flags.map((flag) => ({
        ...this.profile(flag),
        hidden: flag.hidden,
        reportCount: flag.reportCount,
        status: statusView(flag),
      })),
    };
  }
}
