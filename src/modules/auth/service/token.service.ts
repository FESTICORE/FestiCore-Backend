import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../entity/refresh-token.entity';
import { User } from '../entity/user.entity';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface RefreshPayload {
  sub: string;
  typ?: string;
}

/** JWT 발급과 DB 세션 단위의 원자적 refresh 회전·폐기를 담당한다. */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
    private readonly dataSource: DataSource,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async sign(user: Pick<User, 'id' | 'provider'>): Promise<TokenPair> {
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
    return { accessToken, refreshToken };
  }

  private async verifyRefresh(token: string): Promise<RefreshPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshPayload>(token, {
        secret: this.config.get<string>('auth.jwt.refreshSecret'),
      });
      return payload.typ === 'refresh' &&
        typeof payload.sub === 'string' &&
        payload.sub.length > 0
        ? payload
        : null;
    } catch {
      return null;
    }
  }

  /** 새 로그인은 다른 기기나 탭과 독립된 세션을 만든다. */
  async issue(user: User): Promise<TokenPair> {
    const pair = await this.sign(user);
    const sessionId = randomUUID();
    const expiresAt = new Date(
      this.jwt.decode<{ exp: number }>(pair.refreshToken).exp * 1000,
    );
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        'INSERT INTO "refresh_token_sessions" ("id") VALUES ($1)',
        [sessionId],
      );
      await manager.query(
        `INSERT INTO "refresh_tokens"
         ("id", "userId", "sessionId", "tokenHash", "expiresAt", "createdAt")
         VALUES ($1, $2, $3, $4, $5, now())`,
        [
          randomUUID(),
          user.id,
          sessionId,
          this.hash(pair.refreshToken),
          expiresAt,
        ],
      );
    });
    return pair;
  }

  /** 같은 세션의 회전과 폐기는 DB 행 잠금으로 인스턴스 간 직렬화한다. */
  async rotate(refreshToken: string): Promise<TokenPair> {
    const payload = await this.verifyRefresh(refreshToken);
    if (!payload) {
      throw new UnauthorizedException('유효하지 않은 refresh 토큰입니다.');
    }
    const tokenHash = this.hash(refreshToken);
    const row = await this.refreshRepo.findOne({ where: { tokenHash } });
    if (!row || row.userId !== payload.sub) {
      throw new UnauthorizedException('사용할 수 없는 refresh 토큰입니다.');
    }

    return this.dataSource.transaction(async (manager) => {
      const [session] = await manager.query<{ revokedAt: Date | null }[]>(
        `SELECT "revokedAt" FROM "refresh_token_sessions"
         WHERE "id" = $1 FOR UPDATE`,
        [row.sessionId],
      );
      if (!session || session.revokedAt) {
        throw new UnauthorizedException('사용할 수 없는 refresh 토큰입니다.');
      }
      // TypeORM Postgres returns [returnedRows, rowCount] for UPDATE queries.
      const [consumed, count] = await manager.query<
        [{ userId: string }[], number]
      >(
        `UPDATE "refresh_tokens" SET "revokedAt" = now()
         WHERE "tokenHash" = $1 AND "sessionId" = $2
           AND "revokedAt" IS NULL AND "expiresAt" > now()
         RETURNING "userId"`,
        [tokenHash, row.sessionId],
      );
      if (count !== 1 || consumed[0]?.userId !== payload.sub) {
        throw new UnauthorizedException('사용할 수 없는 refresh 토큰입니다.');
      }
      const [user] = await manager.query<Pick<User, 'id' | 'provider'>[]>(
        'SELECT "id", "provider" FROM "users" WHERE "id" = $1',
        [payload.sub],
      );
      if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
      const pair = await this.sign(user);
      const expiresAt = new Date(
        this.jwt.decode<{ exp: number }>(pair.refreshToken).exp * 1000,
      );
      await manager.query(
        `INSERT INTO "refresh_tokens"
         ("id", "userId", "sessionId", "tokenHash", "expiresAt", "createdAt")
         VALUES ($1, $2, $3, $4, $5, now())`,
        [
          randomUUID(),
          user.id,
          row.sessionId,
          this.hash(pair.refreshToken),
          expiresAt,
        ],
      );
      return pair;
    });
  }

  /**
   * 제시된 토큰이 과거에 회전됐어도 그 세션 전체를 폐기한다.
   * 서명/형식 실패만 조용히 처리하고 DB 오류는 호출자에게 전파한다.
   */
  async revokeSession(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefresh(refreshToken);
    if (!payload) return;
    const row = await this.refreshRepo.findOne({
      where: { tokenHash: this.hash(refreshToken) },
    });
    if (!row || row.userId !== payload.sub) return;
    await this.dataSource.transaction(async (manager) => {
      const [session] = await manager.query<{ id: string }[]>(
        `SELECT "id" FROM "refresh_token_sessions"
         WHERE "id" = $1 FOR UPDATE`,
        [row.sessionId],
      );
      if (!session) return;
      await manager.query(
        `UPDATE "refresh_token_sessions" SET "revokedAt" = now()
         WHERE "id" = $1 AND "revokedAt" IS NULL`,
        [row.sessionId],
      );
      await manager.query(
        `UPDATE "refresh_tokens" SET "revokedAt" = now()
         WHERE "sessionId" = $1 AND "revokedAt" IS NULL`,
        [row.sessionId],
      );
    });
  }

  /** 기존 계정 전체 로그아웃 경로에서 사용한다. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
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

  /** 회원 탈퇴: 해당 사용자의 refresh 토큰 레코드를 모두 삭제 */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.refreshRepo.delete({ userId });
  }
}
