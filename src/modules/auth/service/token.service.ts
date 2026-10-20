import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { RefreshToken } from '../entity/refresh-token.entity';
import { User } from '../entity/user.entity';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * 자체 JWT(access/refresh) 발급·검증과 refresh 토큰 회전을 담당한다.
 * refresh 토큰은 원문 대신 sha256 해시만 DB에 저장한다.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(user: User): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, provider: user.provider, typ: 'access' },
      {
        secret: this.config.get<string>('auth.jwt.accessSecret'),
        expiresIn: this.config.get<string>(
          'auth.jwt.accessTtl',
        ) as JwtSignOptions['expiresIn'],
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: randomUUID(), typ: 'refresh' },
      {
        secret: this.config.get<string>('auth.jwt.refreshSecret'),
        expiresIn: this.config.get<string>(
          'auth.jwt.refreshTtl',
        ) as JwtSignOptions['expiresIn'],
      },
    );

    const decoded = this.jwt.decode<{ exp: number }>(refreshToken);
    await this.refreshRepo.save(
      this.refreshRepo.create({
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(decoded.exp * 1000),
      }),
    );

    return { accessToken, refreshToken };
  }

  /**
   * refresh 토큰을 소비(검증 + 폐기)하고 사용자 id를 반환한다(회전).
   */
  async consume(refreshToken: string): Promise<string> {
    let payload: { sub: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('auth.jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('유효하지 않은 refresh 토큰입니다.');
    }
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('유효하지 않은 refresh 토큰입니다.');
    }

    // 조건부 업데이트로 원자적으로 폐기한다. 동시에 같은 토큰이 들어와도 한 요청만 성공한다.
    const result = await this.refreshRepo.update(
      { tokenHash: this.hash(refreshToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (result.affected !== 1) {
      throw new UnauthorizedException('사용할 수 없는 refresh 토큰입니다.');
    }
    return payload.sub;
  }

  /** 로그아웃: 해당 사용자의 유효한 refresh 토큰을 모두 폐기 */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshRepo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** 회원 탈퇴: 해당 사용자의 refresh 토큰 레코드를 모두 삭제 */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.refreshRepo.delete({ userId });
  }
}
