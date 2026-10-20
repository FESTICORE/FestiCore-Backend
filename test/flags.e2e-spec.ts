import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { AdminAuthService } from '../src/modules/admin/auth/admin-auth.service';
import { AdminSessionGuard } from '../src/modules/admin/auth/admin-session.guard';
import { JwtAuthGuard } from '../src/modules/auth/guard/jwt-auth.guard';
import { User } from '../src/modules/auth/entity/user.entity';
import {
  AdminFlagsController,
  BearerController,
  FlagsController,
  MyFlagsController,
} from '../src/modules/flags/flags.controller';
import { FlagsService } from '../src/modules/flags/flags.service';

describe('Flags HTTP authorization (e2e)', () => {
  let app: INestApplication;
  let server: App;
  let jwt: JwtService;
  const service = {
    detail: jest.fn().mockResolvedValue({ flagId: 'flag-1' }),
    readPhoto: jest.fn().mockResolvedValue(Buffer.from('photo')),
    bearerView: jest.fn().mockResolvedValue({ flagId: 'flag-1' }),
    follow: jest.fn().mockResolvedValue({ following: true }),
    createCodes: jest.fn().mockResolvedValue({ codes: [] }),
    listCodes: jest.fn().mockResolvedValue({ items: [] }),
  };
  const adminAuth = {
    validateSession: jest.fn().mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'viewer',
    }),
  };
  const accessSecret = 'flags-test-access-secret';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [
        FlagsController,
        BearerController,
        MyFlagsController,
        AdminFlagsController,
      ],
      providers: [
        { provide: FlagsService, useValue: service },
        { provide: AdminAuthService, useValue: adminAuth },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                'auth.jwt.accessSecret': accessSecret,
                ADMIN_WEB_URL: 'https://admin.example.com',
              })[key],
          },
        },
        AdminSessionGuard,
        JwtAuthGuard,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest
              .fn()
              .mockResolvedValue({ id: 'user-1', provider: 'google' }),
          },
        },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_GUARD, useExisting: AdminSessionGuard },
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
      ],
    }).compile();
    jwt = moduleRef.get(JwtService);
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.listen(0);
    server = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    adminAuth.validateSession.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'viewer',
    });
  });

  const accessToken = async () =>
    jwt.signAsync(
      { sub: 'user-1', provider: 'google', typ: 'access' },
      { secret: accessSecret },
    );

  it('공개 상세는 익명 요청을 허용하며 공유 캐시를 사용하지 않는다', async () => {
    const response = await request(server)
      .get('/api/v1/flags/flag-1')
      .expect(200);
    expect((response.body as { data: unknown }).data).toEqual({
      flagId: 'flag-1',
    });
    expect(response.headers['cache-control']).toBe('private, max-age=30');
  });

  it('공개 사진은 인증 없이 볼 수 있고 이미지 응답에 MIME 고정과 nosniff를 적용한다', async () => {
    const response = await request(server)
      .get('/api/v1/flags/flag-1/photo')
      .expect(200);
    expect(response.headers['content-type']).toMatch(/^image\/webp/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('기수 전용 조회와 팔로우는 익명 요청을 거부한다', async () => {
    await request(server).get('/api/v1/flags/flag-1/bearer').expect(401);
    await request(server)
      .put('/api/v1/flags/flag-1/follow')
      .set('Idempotency-Key', 'follow-1')
      .expect(401);
    expect(service.bearerView).not.toHaveBeenCalled();
    expect(service.follow).not.toHaveBeenCalled();
  });

  it('기수 전용 조회는 refresh JWT를 거부하고 access JWT를 허용한다', async () => {
    const refresh = await jwt.signAsync(
      { sub: 'user-1', provider: 'google', typ: 'refresh' },
      { secret: accessSecret },
    );
    await request(server)
      .get('/api/v1/flags/flag-1/bearer')
      .set('Authorization', `Bearer ${refresh}`)
      .expect(401);
    const response = await request(server)
      .get('/api/v1/flags/flag-1/bearer')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect((response.body as { data: unknown }).data).toEqual({
      flagId: 'flag-1',
    });
  });

  it('앱 access JWT만으로 관리자 코드 목록에 접근할 수 없다', async () => {
    await request(server)
      .get('/api/v1/admin/festivals/festival-1/bearer-codes')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .expect(401);
    expect(service.listCodes).not.toHaveBeenCalled();
  });

  it('viewer 관리자 세션은 코드 생성이 금지되고 editor 세션은 허용된다', async () => {
    const create = () =>
      request(server)
        .post('/api/v1/admin/festivals/festival-1/bearer-codes')
        .set('Cookie', 'festicore_admin_session=session-1')
        .set('Origin', 'https://admin.example.com')
        .send({ count: 1 });
    await create().expect(403);
    expect(service.createCodes).not.toHaveBeenCalled();

    adminAuth.validateSession.mockResolvedValueOnce({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'editor',
    });
    const response = await create().expect(201);
    expect((response.body as { data: unknown }).data).toEqual({ codes: [] });
  });
});
