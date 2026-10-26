import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { AuthController } from '../src/modules/auth/controller/auth.controller';
import { MeController } from '../src/modules/auth/controller/me.controller';
import { RefreshToken } from '../src/modules/auth/entity/refresh-token.entity';
import { User } from '../src/modules/auth/entity/user.entity';
import { JwtAuthGuard } from '../src/modules/auth/guard/jwt-auth.guard';
import { AppleService } from '../src/modules/auth/service/apple.service';
import { AppleRevokeRetryService } from '../src/modules/auth/service/apple-revoke-retry.service';
import { AuthService } from '../src/modules/auth/service/auth.service';
import { GoogleService } from '../src/modules/auth/service/google.service';
import { TokenService } from '../src/modules/auth/service/token.service';
import { FlagPackSyncService } from '../src/modules/flags/flag-pack-sync.service';
import { LiveActivityService } from '../src/modules/notification/live-activity.service';
import { HealthController } from '../src/modules/health/controller/health.controller';
import { HealthService } from '../src/modules/health/service/health.service';
import { LegalController } from '../src/modules/legal/legal.controller';
import { LegalService } from '../src/modules/legal/legal.service';
import { DEFAULT_PRIVACY_CONTENT } from '../src/modules/legal/privacy-content';
import { CacheService } from '../src/modules/redis/service/cache.service';
import { FakeRepository } from './fake-repository';

/**
 * DB 없이 실제 Gateway 규약(전역 필터·응답 인터셉터·JwtAuthGuard)을 그대로 얹은 테스트 앱.
 * 외부 의존(Google/Apple 검증, DataSource)은 스텁으로 대체한다.
 */
export interface TestContext {
  app: INestApplication;
  env: Record<string, unknown>;
  users: FakeRepository<User>;
  refreshTokens: FakeRepository<RefreshToken>;
  google: { [K in keyof GoogleService]: jest.Mock };
  apple: { [K in keyof AppleService]: jest.Mock };
  appleRetry: { enqueue: jest.Mock };
  flagPackSync: { syncMany: jest.Mock; invalidatePacks: jest.Mock };
  dataSource: { query: jest.Mock; transaction: jest.Mock };
  cache: { status: jest.Mock };
}

export async function createTestApp(): Promise<TestContext> {
  const env: Record<string, unknown> = {
    'auth.jwt.accessSecret': 'test-access-secret',
    'auth.jwt.refreshSecret': 'test-refresh-secret',
    'auth.jwt.accessTtl': '30m',
    'auth.jwt.refreshTtl': '14d',
    NODE_ENV: 'test',
  };
  const users = new FakeRepository<User>();
  const refreshTokens = new FakeRepository<RefreshToken>();
  const sessions = new Map<string, { id: string; revokedAt: Date | null }>();
  const google = {
    verify: jest.fn(),
    exchangeAuthCode: jest.fn(),
    revokeConnection: jest.fn(),
  };
  const apple = {
    verify: jest.fn(),
    exchangeWebCode: jest.fn(),
    exchangeAuthCode: jest.fn(),
    revokeConnection: jest.fn().mockResolvedValue(true),
  };
  const appleRetry = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const flagPackSync = {
    syncMany: jest.fn().mockResolvedValue(undefined),
    invalidatePacks: jest.fn().mockResolvedValue(undefined),
  };
  const liveActivity = {
    enqueueWithdrawalImpact: jest.fn().mockResolvedValue(undefined),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    transaction: jest
      .fn()
      .mockImplementation(
        (work: (manager: EntityManager) => Promise<unknown>) =>
          work({
            query: jest
              .fn()
              .mockImplementation((sql: string, params?: unknown[]) => {
                if (sql.includes('INSERT INTO "refresh_token_sessions"')) {
                  const id = params?.[0] as string;
                  sessions.set(id, { id, revokedAt: null });
                  return Promise.resolve([]);
                }
                if (sql.includes('INSERT INTO "refresh_tokens"')) {
                  return refreshTokens.save({
                    id: params?.[0] as string,
                    userId: params?.[1] as string,
                    sessionId: params?.[2] as string,
                    tokenHash: params?.[3] as string,
                    expiresAt: params?.[4] as Date,
                    revokedAt: null,
                  } as RefreshToken);
                }
                if (
                  sql.includes('FROM "refresh_token_sessions"') &&
                  sql.includes('FOR UPDATE')
                ) {
                  const session = sessions.get(params?.[0] as string);
                  return Promise.resolve(session ? [session] : []);
                }
                if (sql.includes('UPDATE "refresh_token_sessions"')) {
                  const ids = sql.includes('SELECT "sessionId"')
                    ? refreshTokens.rows
                        .filter((row) => row.userId === params?.[0])
                        .map((row) => row.sessionId)
                    : [params?.[0] as string];
                  for (const id of ids) {
                    const session = sessions.get(id);
                    if (session) session.revokedAt = new Date();
                  }
                  return Promise.resolve([]);
                }
                if (
                  sql.includes('UPDATE "refresh_tokens"') &&
                  sql.includes('RETURNING "userId"')
                ) {
                  const row = refreshTokens.rows.find(
                    (item) =>
                      item.tokenHash === params?.[0] &&
                      item.sessionId === params?.[1] &&
                      !item.revokedAt,
                  );
                  if (!row) return Promise.resolve([[], 0]);
                  row.revokedAt = new Date();
                  return Promise.resolve([[{ userId: row.userId }], 1]);
                }
                if (sql.includes('SELECT "id", "provider" FROM "users"')) {
                  return users
                    .findOne({ where: { id: params?.[0] } })
                    .then((user) => (user ? [user] : []));
                }
                if (
                  sql.includes('FROM "users"') &&
                  sql.includes('FOR UPDATE')
                ) {
                  return users
                    .findOne({ where: { id: params?.[0] } })
                    .then((user) => (user ? [user] : []));
                }
                if (sql.includes('UPDATE "refresh_tokens"')) {
                  if (sql.includes('WHERE "sessionId"')) {
                    return refreshTokens.update(
                      { sessionId: params?.[0], revokedAt: IsNull() },
                      { revokedAt: new Date() },
                    );
                  }
                  return refreshTokens.update(
                    { userId: params?.[0], revokedAt: IsNull() },
                    { revokedAt: new Date() },
                  );
                }
                return Promise.resolve([]);
              }),
            delete: jest
              .fn()
              .mockImplementation(
                (entity: unknown, where: Record<string, unknown>) => {
                  if (entity === User) return users.delete(where);
                  if (entity === RefreshToken)
                    return refreshTokens.delete(where);
                  throw new Error('지원하지 않는 테스트 엔티티입니다.');
                },
              ),
          } as unknown as EntityManager),
      ),
  };
  const cache = { status: jest.fn().mockResolvedValue('disabled') };

  const moduleRef = await Test.createTestingModule({
    imports: [JwtModule.register({})],
    controllers: [
      AuthController,
      MeController,
      HealthController,
      LegalController,
    ],
    providers: [
      AuthService,
      TokenService,
      HealthService,
      {
        provide: LegalService,
        useValue: {
          privacy: jest.fn().mockResolvedValue({
            content: DEFAULT_PRIVACY_CONTENT,
            version: 0,
            updatedAt: null,
          }),
        },
      },
      { provide: GoogleService, useValue: google },
      { provide: AppleService, useValue: apple },
      { provide: AppleRevokeRetryService, useValue: appleRetry },
      { provide: FlagPackSyncService, useValue: flagPackSync },
      { provide: LiveActivityService, useValue: liveActivity },
      { provide: DataSource, useValue: dataSource },
      { provide: CacheService, useValue: cache },
      { provide: getRepositoryToken(User), useValue: users },
      { provide: getRepositoryToken(RefreshToken), useValue: refreshTokens },
      { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      { provide: APP_GUARD, useClass: JwtAuthGuard },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // 포트를 한 번만 열어 두면 동시 요청에서도 supertest 가 같은 서버를 쓴다.
  await app.listen(0);

  return {
    app,
    env,
    users,
    refreshTokens,
    google: google,
    apple: apple,
    appleRetry,
    flagPackSync,
    dataSource,
    cache,
  };
}
