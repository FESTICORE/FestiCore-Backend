import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { Crew, CrewGather, CrewMember } from '../crews/crew.entity';
import { Flag, FlagBearer, FlagFollow, FlagPin } from '../flags/flag.entity';
import { PublicFestivalService } from './public-festival.service';

type AccessPayload = { sub?: string; provider?: string; typ?: string };

function iso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

@Injectable()
export class PublicLiveService {
  private readonly logger = new Logger(PublicLiveService.name);
  private lastRateLimitCleanupMinute = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly festivals: PublicFestivalService,
    @InjectRepository(Flag) private readonly flags: Repository<Flag>,
    @InjectRepository(FlagFollow)
    private readonly follows: Repository<FlagFollow>,
    @InjectRepository(FlagPin) private readonly pins: Repository<FlagPin>,
    @InjectRepository(FlagBearer)
    private readonly bearers: Repository<FlagBearer>,
    @InjectRepository(Crew) private readonly crews: Repository<Crew>,
    @InjectRepository(CrewMember)
    private readonly members: Repository<CrewMember>,
    @InjectRepository(CrewGather)
    private readonly gathers: Repository<CrewGather>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  private async userId(authorization?: string): Promise<string | null> {
    if (!authorization) return null;
    const match = authorization.match(/^Bearer ([^ ]+)$/);
    if (!match)
      throw new UnauthorizedException('유효하지 않은 인증 헤더입니다.');
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(match[1], {
        secret: this.config.get<string>('auth.jwt.accessSecret'),
      });
      if (payload.typ !== 'access' || !payload.sub || !payload.provider)
        throw new Error('invalid access token');
      return payload.sub;
    } catch {
      throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
    }
  }

  private async limit(deviceId: string, now: Date): Promise<void> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        deviceId,
      )
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'X-Device-Id UUID가 필요합니다.',
      });
    const minute = Math.floor(now.getTime() / 60_000);
    const rows = await this.dataSource.query<{ count: number }[]>(
      `INSERT INTO public_live_rate_limits (device_id, minute, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (device_id, minute) DO UPDATE SET count = public_live_rate_limits.count + 1
       RETURNING count`,
      [deviceId, minute],
    );
    if (minute - this.lastRateLimitCleanupMinute >= 60) {
      this.lastRateLimitCleanupMinute = minute;
      try {
        await this.dataSource.query(
          'DELETE FROM public_live_rate_limits WHERE minute < $1',
          [minute - 120],
        );
      } catch {
        this.logger.warn('지난 라이브 요청 제한 기록 정리에 실패했습니다.');
      }
    }
    if (Number(rows[0]?.count) > 4)
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: '라이브 조회 횟수를 초과했습니다.',
          retryAfter: 60 - (Math.floor(now.getTime() / 1000) % 60),
        },
        429,
      );
  }

  private async me(festivalId: string, userId: string) {
    const [follows, pin, bearers, festivalFlags, membership] =
      await Promise.all([
        this.follows.find({
          where: { festivalId, userId },
          order: { followedAt: 'ASC' },
        }),
        this.pins.findOne({ where: { userId } }),
        this.bearers.find({ where: { userId } }),
        this.flags.find({ where: { festivalId } }),
        this.members.findOne({ where: { festivalId, userId } }),
      ]);
    let crew: Record<string, unknown> | null = null;
    if (membership) {
      const row = await this.crews.findOne({
        where: { id: membership.crewId, archivedAt: IsNull() },
      });
      if (row) {
        const [members, gather] = await Promise.all([
          this.members.find({
            where: { crewId: row.id },
            order: { joinedAt: 'ASC' },
          }),
          this.gathers.findOne({
            where: { crewId: row.id },
            order: { createdAt: 'DESC' },
          }),
        ]);
        const now = Date.now();
        crew = {
          id: row.id,
          name: row.name,
          ownerId: row.ownerId,
          members: members.map((member) => ({
            userId: member.userId,
            nickname: member.nickname,
            zoneId: member.zoneId,
            state: member.state,
            updatedAt: member.statusUpdatedAt
              ? iso(member.statusUpdatedAt)
              : null,
          })),
          gatherRequest:
            gather && now - gather.createdAt.getTime() < 600_000
              ? {
                  zoneId: gather.zoneId,
                  byUserId: gather.byUserId,
                  at: iso(gather.createdAt),
                }
              : null,
          gatherAvailableAt:
            row.lastGatherAt && row.lastGatherAt.getTime() + 600_000 > now
              ? iso(new Date(row.lastGatherAt.getTime() + 600_000))
              : null,
        };
      }
    }
    const following = follows.map((follow) => follow.flagId);
    return {
      following,
      pinnedFlagId:
        pin?.flagId && following.includes(pin.flagId) ? pin.flagId : null,
      crew,
      bearerOf: bearers
        .map((bearer) => bearer.flagId)
        .filter((id) => festivalFlags.some((flag) => flag.id === id)),
    };
  }

  async board(
    festivalId: string,
    deviceId: string | undefined,
    authorization?: string,
  ) {
    const now = new Date();
    const userId = await this.userId(authorization);
    const pack = await this.festivals.published(festivalId);
    await this.limit(deviceId ?? '', now);
    const flags =
      pack.flagsEnabled === false
        ? []
        : await this.flags.find({
            where: {
              festivalId,
              visibility: 'public',
              hidden: false,
              status: Not('scheduled'),
            },
          });
    flags.sort(
      (a, b) =>
        (b.statusUpdatedAt ?? b.updatedAt).getTime() -
        (a.statusUpdatedAt ?? a.updatedAt).getTime(),
    );
    const me = userId ? await this.me(festivalId, userId) : null;
    const state = {
      festivalId,
      setOverrides: [],
      activeFlags: flags.slice(0, 50).map((flag) => ({
        flagId: flag.id,
        status: flag.status,
        zoneId: flag.zoneId,
        activity: flag.activity,
        updatedAt: iso(flag.statusUpdatedAt ?? flag.updatedAt),
      })),
      me,
    };
    return {
      body: { ...state, serverAt: iso(now) },
      etag: `"${createHash('sha256').update(JSON.stringify(state)).digest('hex')}"`,
    };
  }
}
