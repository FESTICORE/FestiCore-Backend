import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { AuthController } from '../src/modules/auth/controller/auth.controller';
import { RefreshToken } from '../src/modules/auth/entity/refresh-token.entity';
import { User } from '../src/modules/auth/entity/user.entity';
import { JwtAuthGuard } from '../src/modules/auth/guard/jwt-auth.guard';
import { AppleService } from '../src/modules/auth/service/apple.service';
import { AuthService } from '../src/modules/auth/service/auth.service';
import { GoogleService } from '../src/modules/auth/service/google.service';
import { TokenService } from '../src/modules/auth/service/token.service';
import { HealthController } from '../src/modules/health/controller/health.controller';
import { HealthService } from '../src/modules/health/service/health.service';
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
  dataSource: { query: jest.Mock };
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
  const google = {
    verify: jest.fn(),
    exchangeAuthCode: jest.fn(),
    revokeConnection: jest.fn(),
  };
  const apple = {
    verify: jest.fn(),
    exchangeWebCode: jest.fn(),
    exchangeAuthCode: jest.fn(),
    revokeConnection: jest.fn(),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [JwtModule.register({})],
    controllers: [AuthController, HealthController],
    providers: [
      AuthService,
      TokenService,
      HealthService,
      { provide: GoogleService, useValue: google },
      { provide: AppleService, useValue: apple },
      { provide: DataSource, useValue: dataSource },
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
    dataSource,
  };
}
