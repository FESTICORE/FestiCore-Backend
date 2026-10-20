import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { SocialLoginDto } from '../dto/social-login.dto';
import { User } from '../entity/user.entity';
import type { SocialProfile } from '../types/social-profile';
import type { OauthGrant } from '../types/social-profile';
import { AppleService } from './apple.service';
import { GoogleService } from './google.service';
import { TokenService } from './token.service';

// Postgres unique 제약 위반 코드.
const UNIQUE_VIOLATION = '23505';

export interface UserView {
  id: string;
  provider: string;
  email: string | null;
  nickname: string | null;
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

  constructor(
    private readonly google: GoogleService,
    private readonly apple: AppleService,
    private readonly token: TokenService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async login(dto: SocialLoginDto): Promise<LoginResult> {
    const profile = await this.verify(dto);
    const { user, isNew } = await this.findOrCreate(profile);
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
    if (grant?.refreshToken && grant.subject === profile.providerId) {
      await this.userRepo.update(
        { id: user.id },
        {
          oauthWebRefreshToken: grant.refreshToken,
          oauthWebClientId: grant.clientId ?? null,
        },
      );
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
    const userId = await this.token.consume(refreshToken);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    return this.token.issue(user);
  }

  /** 로그아웃: 해당 사용자의 refresh 토큰 전체 폐기 */
  async logout(userId: string): Promise<void> {
    await this.token.revokeAllForUser(userId);
  }

  async me(userId: string): Promise<UserView> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    return this.toView(user);
  }

  async updateMe(userId: string, nickname: string): Promise<UserView> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    user.nickname = nickname;
    await this.userRepo.save(user);
    return this.toView(user);
  }

  /**
   * 회원 탈퇴: provider 연동 해제(revoke) → refresh 토큰 삭제 → 사용자 삭제.
   * provider revoke 실패는 계정 삭제를 막지 않는다.
   */
  async withdraw(userId: string): Promise<void> {
    // oauthRefreshToken은 select:false라 명시적으로 조회한다.
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        id: true,
        provider: true,
        oauthRefreshToken: true,
        oauthClientId: true,
        oauthWebRefreshToken: true,
        oauthWebClientId: true,
      },
    });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    if (user.oauthRefreshToken) {
      if (user.provider === 'google') {
        await this.google.revokeConnection(user.oauthRefreshToken);
      } else {
        await this.apple.revokeConnection(
          user.oauthRefreshToken,
          user.oauthClientId ?? undefined,
        );
      }
    } else {
      this.logger.warn(
        `provider 토큰이 없어 연동 해제를 건너뜁니다: ${user.provider} ${user.id}`,
      );
    }
    if (
      user.oauthWebRefreshToken &&
      user.oauthWebRefreshToken !== user.oauthRefreshToken
    ) {
      if (user.provider === 'google') {
        await this.google.revokeConnection(user.oauthWebRefreshToken);
      } else {
        await this.apple.revokeConnection(
          user.oauthWebRefreshToken,
          user.oauthWebClientId ?? undefined,
        );
      }
    }
    await this.token.deleteAllForUser(userId);
    await this.userRepo.delete({ id: userId });
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
    await this.userRepo.update(
      { id: user.id },
      {
        oauthRefreshToken: grant.refreshToken,
        oauthClientId: grant.clientId ?? null,
      },
    );
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
          nickname: profile.name?.slice(0, 30) ?? null,
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

  private toView(user: User): UserView {
    return {
      id: user.id,
      provider: user.provider,
      email: user.email,
      nickname: user.nickname,
      profileImageUrl: user.profileImageUrl,
    };
  }
}
