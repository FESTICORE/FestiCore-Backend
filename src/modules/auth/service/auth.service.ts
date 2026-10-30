import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { SocialLoginDto } from '../dto/social-login.dto';
import { RefreshToken } from '../entity/refresh-token.entity';
import { User } from '../entity/user.entity';
import { FlagPackSyncService } from '../../flags/flag-pack-sync.service';
import { LiveActivityService } from '../../notification/live-activity.service';
import type { SocialProfile } from '../types/social-profile';
import type { OauthGrant } from '../types/social-profile';
import { AppleService } from './apple.service';
import { AppleRevokeRetryService } from './apple-revoke-retry.service';
import { GoogleService } from './google.service';
import { TokenService } from './token.service';
import { OauthTokenCipher } from './oauth-token-cipher';
import { CURRENT_TERMS_VERSION } from '../terms';

// Postgres unique 제약 위반 코드.
const UNIQUE_VIOLATION = '23505';
export { CURRENT_TERMS_VERSION } from '../terms';

export interface UpdateMeInput {
  nickname?: string;
  acceptTerms?: { version: string };
  pushOptIn?: boolean;
}

export interface UserView {
  id: string;
  provider: string;
  email: string | null;
  nickname: string | null;
  nicknameConfirmed: boolean;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  pushOptIn: boolean;
  profileImageUrl: string | null;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  /** 이번 로그인에서 계정이 새로 생성됐으면 true(=회원가입), 기존 로그인이면 false. */
  newUser: boolean;
  user: UserView;
}

/**
 * 소셜 로그인 오케스트레이션.
 * provider별 검증 서비스 → SocialProfile → 사용자 find-or-create → 자체 JWT 발급.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly oauthCipher = new OauthTokenCipher(process.env);

  constructor(
    private readonly google: GoogleService,
    private readonly apple: AppleService,
    private readonly token: TokenService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly appleRetry: AppleRevokeRetryService,
    private readonly flagPackSync: FlagPackSyncService,
    private readonly liveActivity: LiveActivityService,
  ) {}

  async login(dto: SocialLoginDto): Promise<LoginResult> {
    const profile = await this.verify(dto);
    const { user, isNew } = await this.findOrCreate(profile);
    await this.bindVerifiedAdminGrant(profile, user.id);
    await this.storeOauthRefreshToken(user, dto);
    const tokens = await this.token.issue(user);
    return { ...tokens, newUser: isNew, user: this.toView(user) };
  }

  /** 웹 OAuth 콜백에서 검증이 끝난 프로필만 계정으로 연결한다. */
  async completeWebLogin(
    profile: SocialProfile,
    grant?: OauthGrant,
  ): Promise<{ userId: string; newUser: boolean }> {
    const { user, isNew } = await this.findOrCreate(profile);
    await this.bindVerifiedAdminGrant(profile, user.id);
    if (grant?.refreshToken && grant.subject === profile.providerId) {
      const updated = await this.userRepo.update(
        { id: user.id },
        {
          oauthWebRefreshToken: this.oauthCipher.encode(
            grant.refreshToken,
            user.id,
            'oauthWebRefreshToken',
          ),
          oauthWebClientId: grant.clientId ?? null,
        },
      );
      if (updated.affected !== 1) {
        await this.revokeOrphanedGrant(
          profile.provider,
          grant.refreshToken,
          grant.clientId,
        );
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }
    }
    return { userId: user.id, newUser: isNew };
  }

  /** 일회용 웹 교환 티켓 소비 후에만 토큰을 발급한다. */
  async issueWebLogin(userId: string, newUser: boolean): Promise<LoginResult> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    const tokens = await this.token.issue(user);
    return { ...tokens, newUser, user: this.toView(user) };
  }

  /** refresh 토큰 회전: 기존 토큰 폐기 후 새 access/refresh 발급 */
  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    return this.token.rotate(refreshToken);
  }

  async revokeSession(refreshToken: string): Promise<void> {
    await this.token.revokeSession(refreshToken);
  }

  /** 로그아웃: 계정 토큰과 계정 소유 기기 전체의 푸시 수신을 해제한다. */
  async logout(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE "devices"
         SET "apnsToken" = NULL, "liveActivityPushToStartToken" = NULL,
             "liveActivityPushToken" = NULL, "liveActivityFestivalId" = NULL,
             "liveActivityId" = NULL, "updatedAt" = now()
         WHERE "userId" = $1`,
        [userId],
      );
      // 핀·다운로드 기록은 유지하고 이 계정의 푸시 구독만 해제한다.
      await manager.query(
        `UPDATE "device_subscriptions"
         SET "packUpdates" = false, "festivalStarts" = false, "reminders" = false
         WHERE "deviceId" IN (SELECT "id" FROM "devices" WHERE "userId" = $1)`,
        [userId],
      );
      await manager.query(
        `UPDATE "refresh_token_sessions" SET "revokedAt" = now()
         WHERE "id" IN (SELECT "sessionId" FROM "refresh_tokens" WHERE "userId" = $1)
           AND "revokedAt" IS NULL`,
        [userId],
      );
      await manager.query(
        `UPDATE "refresh_tokens" SET "revokedAt" = now()
         WHERE "userId" = $1 AND "revokedAt" IS NULL`,
        [userId],
      );
    });
  }

  async me(userId: string): Promise<
    UserView & {
      currentTermsVersion: string;
      admin: { id: string; role: string } | null;
    }
  > {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    const admins =
      user.provider === 'google'
        ? await this.dataSource.query<{ id: string; role: string }[]>(
            `SELECT "id", "role" FROM "admin_accounts" WHERE "userId" = $1 AND "active" = true`,
            [userId],
          )
        : [];
    return {
      ...this.toView(user),
      currentTermsVersion: CURRENT_TERMS_VERSION,
      admin: admins[0] ?? null,
    };
  }

  async updateMe(userId: string, input: UpdateMeInput): Promise<UserView> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    if (
      input.acceptTerms &&
      input.acceptTerms.version !== CURRENT_TERMS_VERSION
    ) {
      throw new HttpException(
        {
          code: 'TERMS_VERSION_OUTDATED',
          message: '현재 약관 버전에 다시 동의해야 합니다.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (input.nickname !== undefined) {
      user.nickname = input.nickname;
      user.nicknameExplicitlySet = true;
    }
    if (input.acceptTerms) {
      user.termsVersion = CURRENT_TERMS_VERSION;
      user.termsAcceptedAt = new Date();
    }
    if (input.pushOptIn !== undefined) user.pushOptIn = input.pushOptIn;
    if (
      user.nicknameExplicitlySet &&
      user.nickname &&
      user.termsVersion === CURRENT_TERMS_VERSION &&
      user.termsAcceptedAt
    ) {
      user.nicknameConfirmed = true;
    }
    await this.userRepo.save(user);
    return this.toView(user);
  }

  /**
   * 회원 탈퇴: provider 연동 해제(revoke) 후 재시도 건과 데이터 정리를 원자적으로 저장한다.
   */
  async withdraw(userId: string): Promise<void> {
    const changedFestivals = await this.dataSource.transaction(
      async (manager) => {
        await manager.query(
          `SELECT pg_advisory_xact_lock(hashtext('admin_account_management'))`,
        );
        // 갱신된 OAuth grant를 놓치지 않도록 사용자 행을 잠근 뒤 최신 토큰을 읽는다.
        const [user] = await manager.query<User[]>(
          `SELECT "id", "provider", "oauthRefreshToken", "oauthClientId",
                "oauthWebRefreshToken", "oauthWebClientId"
         FROM "users" WHERE "id" = $1 FOR UPDATE`,
          [userId],
        );
        if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
        const oauthRefreshToken = this.oauthCipher.decode(
          user.oauthRefreshToken,
          user.id,
          'oauthRefreshToken',
        );
        const oauthWebRefreshToken = this.oauthCipher.decode(
          user.oauthWebRefreshToken,
          user.id,
          'oauthWebRefreshToken',
        );
        const [admin] = await manager.query<{ id: string; role: string }[]>(
          `SELECT "id", "role" FROM "admin_accounts" WHERE "userId" = $1 AND "active" = true FOR UPDATE`,
          [userId],
        );
        if (admin?.role === 'owner') {
          const [{ count }] = await manager.query<{ count: number }[]>(
            `SELECT count(*)::int AS count FROM "admin_accounts" WHERE "role" = 'owner' AND "active" = true`,
          );
          if (count <= 1)
            throw new ConflictException(
              '마지막 owner 계정은 탈퇴할 수 없습니다.',
            );
        }
        if (admin) {
          await manager.query(
            `UPDATE "admin_accounts" SET "active" = false WHERE "id" = $1`,
            [admin.id],
          );
          await manager.query(
            `INSERT INTO "admin_audit" ("actor", "action", "target", "before", "after")
           VALUES ($1, 'admin.withdraw', $2, $3::jsonb, $4::jsonb)`,
            [
              admin.id,
              `admin:${admin.id}`,
              JSON.stringify({ role: admin.role, active: true }),
              JSON.stringify({ role: admin.role, active: false }),
            ],
          );
        }
        const failedAppleRevokes: { token: string; clientId?: string }[] = [];
        if (oauthRefreshToken) {
          if (user.provider === 'google') {
            await this.google.revokeConnection(oauthRefreshToken);
          } else {
            const succeeded = await this.apple.revokeConnection(
              oauthRefreshToken,
              user.oauthClientId ?? undefined,
            );
            if (!succeeded)
              failedAppleRevokes.push({
                token: oauthRefreshToken,
                clientId: user.oauthClientId ?? undefined,
              });
          }
        } else {
          this.logger.warn(
            `provider 토큰이 없어 연동 해제를 건너뜁니다: ${user.provider} ${user.id}`,
          );
        }
        if (
          oauthWebRefreshToken &&
          oauthWebRefreshToken !== oauthRefreshToken
        ) {
          if (user.provider === 'google') {
            await this.google.revokeConnection(oauthWebRefreshToken);
          } else {
            const succeeded = await this.apple.revokeConnection(
              oauthWebRefreshToken,
              user.oauthWebClientId ?? undefined,
            );
            if (!succeeded)
              failedAppleRevokes.push({
                token: oauthWebRefreshToken,
                clientId: user.oauthWebClientId ?? undefined,
              });
          }
        }
        for (const failed of failedAppleRevokes)
          await this.appleRetry.enqueue(failed.token, failed.clientId, manager);
        // 크루 변경 API와 동일하게 크루 행부터 잠가 소유권 이전/탈퇴 경쟁을 직렬화한다.
        const ownedCrews = await manager.query<{ id: string }[]>(
          `SELECT "id" FROM "crews" WHERE "ownerId" = $1 ORDER BY "id" FOR UPDATE`,
          [userId],
        );
        const memberCrews = await manager.query<
          { crewId: string; festivalId: string }[]
        >(
          `SELECT "crewId", "festivalId" FROM "crew_members"
           WHERE "userId" = $1 ORDER BY "crewId"`,
          [userId],
        );
        for (const crew of ownedCrews) {
          const successors = await manager.query<{ userId: string }[]>(
            `SELECT "userId" FROM "crew_members"
           WHERE "crewId" = $1 AND "userId" <> $2
           ORDER BY "joinedAt", "userId" LIMIT 1`,
            [crew.id, userId],
          );
          if (successors.length > 0) {
            await manager.query(
              `UPDATE "crews" SET "ownerId" = $1, "updatedAt" = now() WHERE "id" = $2`,
              [successors[0].userId, crew.id],
            );
          } else {
            await manager.query(`DELETE FROM "crews" WHERE "id" = $1`, [
              crew.id,
            ]);
          }
        }
        // 소유 깃발과 팔로우 중인 깃발을 ID 순서로 잠가 기수 변경/팔로워 수 갱신을 직렬화한다.
        const affectedFlags = await manager.query<
          {
            id: string;
            ownerId: string | null;
            festivalId: string;
            hidden: boolean;
          }[]
        >(
          `SELECT "id", "ownerId", "festivalId", "hidden" FROM "flags"
         WHERE "ownerId" = $1 OR "id" IN (
           SELECT "flagId" FROM "flag_follows" WHERE "userId" = $1
         ) OR "id" IN (
           SELECT "flagId" FROM "flag_reports" WHERE "userId" = $1
         ) ORDER BY "id" FOR UPDATE`,
          [userId],
        );
        // 탈퇴로 재계산하거나 갱신할 축제 행을 동일한 순서로 먼저 잠근다.
        // 기기/사용자 삭제보다 앞서 잡아 아래 팩 동기화까지 잠금을 유지한다.
        const affectedFestivalIds = [
          ...new Set([
            ...memberCrews.map((crew) => crew.festivalId),
            ...affectedFlags.map((flag) => flag.festivalId),
          ]),
        ].sort();
        if (affectedFestivalIds.length) {
          await manager.query(
            `SELECT "id" FROM "admin_festivals"
             WHERE "id" = ANY($1::varchar[]) ORDER BY "id" FOR UPDATE`,
            [affectedFestivalIds],
          );
        }
        const hiddenFestivals = new Set<string>();
        for (const flag of affectedFlags) {
          if (flag.ownerId !== userId) continue;
          const successors = await manager.query<{ userId: string }[]>(
            `SELECT "userId" FROM "flag_bearers"
           WHERE "flagId" = $1 AND "userId" <> $2
           ORDER BY "createdAt", "id" LIMIT 1`,
            [flag.id, userId],
          );
          if (successors.length) {
            await manager.query(
              `UPDATE "flags" SET "ownerId" = $1, "updatedAt" = now() WHERE "id" = $2`,
              [successors[0].userId, flag.id],
            );
            await manager.query(
              `UPDATE "flag_bearers" SET "isOwner" = true WHERE "flagId" = $1 AND "userId" = $2`,
              [flag.id, successors[0].userId],
            );
          } else {
            if (!flag.hidden) hiddenFestivals.add(flag.festivalId);
            await manager.query(
              `UPDATE "flags" SET "ownerId" = NULL, "hidden" = true, "updatedAt" = now() WHERE "id" = $1`,
              [flag.id],
            );
            await manager.query(
              `INSERT INTO "admin_notifications" ("kind", "flagId", "festivalId", "message")
             SELECT 'FLAG_OWNER_WITHDRAWN', "id", "festivalId", '기수가 없는 깃발을 숨겼습니다.'
             FROM "flags" WHERE "id" = $1`,
              [flag.id],
            );
          }
        }
        await manager.query(
          `UPDATE "flag_status_events" SET "userId" = NULL WHERE "userId" = $1`,
          [userId],
        );
        await manager.query(
          `UPDATE "flag_bearer_codes" SET "usedBy" = NULL, "expiresAt" = now()
         WHERE "usedBy" = $1`,
          [userId],
        );
        // 발급/회전과 같은 잠금 순서로 세션부터 막고, 탈퇴 시 고아 세션도 지운다.
        await manager.query(
          `UPDATE "refresh_token_sessions" SET "revokedAt" = now()
           WHERE "id" IN (SELECT "sessionId" FROM "refresh_tokens" WHERE "userId" = $1)
             AND "revokedAt" IS NULL`,
          [userId],
        );
        const sessions = await manager.query<{ sessionId: string }[]>(
          `SELECT DISTINCT "sessionId" FROM "refresh_tokens" WHERE "userId" = $1`,
          [userId],
        );
        await manager.delete(RefreshToken, { userId });
        if (sessions.length > 0) {
          await manager.query(
            `DELETE FROM "refresh_token_sessions" WHERE "id" = ANY($1::uuid[])`,
            [sessions.map((session) => session.sessionId)],
          );
        }
        await manager.query(
          `DELETE FROM "device_subscriptions" WHERE "deviceId" IN (
          SELECT "id" FROM "devices" WHERE "userId" = $1
        )`,
          [userId],
        );
        await manager.query(
          `DELETE FROM "metric_events" WHERE "deviceId" IN (
          SELECT "id" FROM "devices" WHERE "userId" = $1
        )`,
          [userId],
        );
        await manager.query(`DELETE FROM "devices" WHERE "userId" = $1`, [
          userId,
        ]);
        await manager.delete(User, { id: userId });
        for (const flag of affectedFlags) {
          await manager.query(
            `UPDATE "flags" SET "followerCount" = (
             SELECT count(*) FROM "flag_follows" WHERE "flagId" = $1
           ), "reportCount" = (
             SELECT count(*) FROM "flag_reports" WHERE "flagId" = $1
           ), "updatedAt" = now() WHERE "id" = $1`,
            [flag.id],
          );
        }
        const changedFestivals = affectedFlags.length
          ? await this.flagPackSync.syncMany(
              affectedFlags.map((flag) => flag.id),
              manager,
            )
          : [];
        await this.liveActivity.enqueueWithdrawalImpact(
          memberCrews.map((crew) => crew.crewId),
          [...hiddenFestivals],
          manager,
        );
        return changedFestivals;
      },
    );
    if (changedFestivals?.length)
      await this.flagPackSync.invalidatePacks(changedFestivals);
  }

  private verify(dto: SocialLoginDto): Promise<SocialProfile> {
    return dto.provider === 'google'
      ? this.google.verify(dto.token)
      : this.apple.verify(dto.token, dto.name);
  }

  /**
   * authorizationCode가 있으면 provider refresh 토큰을 교환·저장한다.
   * 교환 실패 시 로그인은 계속하고, 다음 로그인의 새 코드로 다시 교환한다.
   * 교환 결과의 sub 가 로그인 사용자와 일치할 때만 저장한다.
   */
  private async storeOauthRefreshToken(
    user: User,
    dto: SocialLoginDto,
  ): Promise<void> {
    if (!dto.authorizationCode) return;
    const grant =
      dto.provider === 'google'
        ? await this.google.exchangeAuthCode(dto.authorizationCode)
        : await this.apple.exchangeAuthCode(dto.authorizationCode);
    if (!grant) {
      this.logger.warn(
        `provider 토큰 교환 실패, 다음 로그인에서 재시도: ${dto.provider} ${user.id}`,
      );
      return;
    }
    // 다른 계정의 code 가 섞여 들어오면 잘못된 계정에 토큰이 연결되므로 저장하지 않는다.
    if (grant.subject !== user.providerId) {
      this.logger.warn(
        `authorizationCode 사용자가 로그인 사용자와 달라 저장하지 않습니다: ${dto.provider} ${user.id}`,
      );
      return;
    }
    user.oauthRefreshToken = grant.refreshToken;
    user.oauthClientId = grant.clientId ?? null;
    const updated = await this.userRepo.update(
      { id: user.id },
      {
        oauthRefreshToken: this.oauthCipher.encode(
          grant.refreshToken,
          user.id,
          'oauthRefreshToken',
        ),
        oauthClientId: grant.clientId ?? null,
      },
    );
    if (updated.affected !== 1) {
      await this.revokeOrphanedGrant(
        dto.provider,
        grant.refreshToken,
        grant.clientId,
      );
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
  }

  private async revokeOrphanedGrant(
    provider: 'google' | 'apple',
    refreshToken: string,
    clientId?: string,
  ): Promise<void> {
    if (provider === 'google') {
      await this.google.revokeConnection(refreshToken);
      return;
    }
    const succeeded = await this.apple.revokeConnection(refreshToken, clientId);
    if (!succeeded) await this.appleRetry.enqueue(refreshToken, clientId);
  }

  /**
   * (provider, providerId)로 사용자를 찾고 없으면 만든다.
   * 같은 계정의 첫 로그인이 동시에 들어와 unique 제약에 걸리면 재조회해 기존 사용자로 처리한다.
   */
  private async findOrCreate(
    profile: SocialProfile,
  ): Promise<{ user: User; isNew: boolean }> {
    const where = {
      provider: profile.provider,
      providerId: profile.providerId,
    };
    const existing = await this.userRepo.findOne({ where });
    if (existing) return { user: existing, isNew: false };

    try {
      const user = await this.userRepo.save(
        this.userRepo.create({
          ...where,
          email: profile.email ?? null,
          nickname:
            Array.from(profile.name?.trim() ?? '')
              .slice(0, 12)
              .join('') ||
            `관객-${randomBytes(2).toString('hex').toUpperCase()}`,
          nicknameConfirmed: false,
          termsAcceptedAt: null,
          termsVersion: null,
          pushOptIn: false,
          profileImageUrl: profile.picture ?? null,
        }),
      );
      return { user, isNew: true };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const user = await this.userRepo.findOne({ where });
      if (!user) throw error;
      return { user, isNew: false };
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code ===
        UNIQUE_VIOLATION
    );
  }

  private async bindVerifiedAdminGrant(
    profile: SocialProfile,
    userId: string,
  ): Promise<void> {
    if (
      profile.provider !== 'google' ||
      !profile.emailVerified ||
      !profile.email
    )
      return;
    const email = profile.email.trim().toLowerCase();
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('admin_account_management'))`,
      );
      const [currentUser] = await manager.query<{ id: string }[]>(
        `SELECT "id" FROM "users" WHERE "id" = $1 FOR KEY SHARE`,
        [userId],
      );
      if (!currentUser) return;
      const [bound] = await manager.query<{ id: string; role: string }[]>(
        `UPDATE "admin_accounts" SET "userId" = $1
         WHERE "email" = $2 AND "userId" IS NULL AND "active" = true
           AND NOT EXISTS (SELECT 1 FROM "admin_accounts" WHERE "userId" = $1)
         RETURNING "id", "role"`,
        [userId, email],
      );
      if (!bound) return;
      await manager.query(
        `INSERT INTO "admin_audit" ("actor", "action", "target", "before", "after")
         VALUES ($1, 'admin.bind', $2, $3::jsonb, $4::jsonb)`,
        [
          bound.id,
          `admin:${bound.id}`,
          JSON.stringify({ email, role: bound.role, userId: null }),
          JSON.stringify({ email, role: bound.role, userId }),
        ],
      );
    });
  }

  private toView(user: User): UserView {
    return {
      id: user.id,
      provider: user.provider,
      email: user.email,
      nickname: user.nickname,
      nicknameConfirmed: user.nicknameConfirmed ?? false,
      termsAcceptedAt: user.termsAcceptedAt ?? null,
      termsVersion: user.termsVersion ?? null,
      pushOptIn: user.pushOptIn ?? false,
      profileImageUrl: user.profileImageUrl,
    };
  }
}
