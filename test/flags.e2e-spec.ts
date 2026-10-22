import { ForbiddenException, INestApplication } from '@nestjs/common';
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
import { CurrentTermsGuard } from '../src/modules/auth/guard/current-terms.guard';
import { CURRENT_TERMS_VERSION } from '../src/modules/auth/service/auth.service';
import { User } from '../src/modules/auth/entity/user.entity';
import {
  AdminFlagsController,
  BearerController,
  FlagsController,
  MyFlagsController,
} from '../src/modules/flags/flags.controller';
import { FlagsService } from '../src/modules/flags/flags.service';

describe('Flags HTTP authorization (e2e)', () => {
  const previousTermsEnforcement = process.env.CURRENT_TERMS_ENFORCED;
  let app: INestApplication;
  let server: App;
  let jwt: JwtService;
  const service = {
    detail: jest.fn().mockResolvedValue({ flagId: 'flag-1' }),
    readPhoto: jest.fn().mockResolvedValue(Buffer.from('photo')),
    bearerView: jest.fn().mockResolvedValue({ flagId: 'flag-1' }),
    follow: jest.fn().mockResolvedValue({ following: true }),
    unfollow: jest.fn().mockResolvedValue({ following: false }),
    claim: jest.fn().mockResolvedValue({ flagId: 'flag-1', isNew: true }),
    createCodes: jest.fn().mockResolvedValue({ codes: [] }),
    listCodes: jest.fn().mockResolvedValue({ items: [] }),
  };
  const adminAuth = {
    findActiveByUserId: jest
      .fn()
      .mockRejectedValue(new ForbiddenException('관리자 권한이 없습니다.')),
  };
  const accessSecret = 'flags-test-access-secret';
  let acceptedTerms = true;

  beforeAll(async () => {
    process.env.CURRENT_TERMS_ENFORCED = 'true';
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
        CurrentTermsGuard,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn().mockImplementation(() =>
              Promise.resolve({
                id: 'user-1',
                provider: 'google',
                termsAcceptedAt: acceptedTerms ? new Date('2026-10-22') : null,
                termsVersion: acceptedTerms ? CURRENT_TERMS_VERSION : null,
              }),
            ),
          },
        },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        { provide: APP_GUARD, useExisting: AdminSessionGuard },
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
    if (previousTermsEnforcement === undefined)
      delete process.env.CURRENT_TERMS_ENFORCED;
    else process.env.CURRENT_TERMS_ENFORCED = previousTermsEnforcement;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    acceptedTerms = true;
    adminAuth.findActiveByUserId.mockRejectedValue(
      new ForbiddenException('관리자 권한이 없습니다.'),
    );
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

  it('약관 동의 전에는 계정 쓰기를 막고 조회를 허용하며 동의 후 쓰기를 허용한다', async () => {
    const token = await accessToken();
    acceptedTerms = false;
    const denied = await request(server)
      .put('/api/v1/flags/flag-1/follow')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'follow-terms')
      .expect(403);
    expect((denied.body as { code: string }).code).toBe('TERMS_REQUIRED');
    expect(service.follow).not.toHaveBeenCalled();
    await request(server)
      .delete('/api/v1/flags/flag-1/follow')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(service.unfollow).toHaveBeenCalledWith('flag-1', 'user-1');
    await request(server)
      .get('/api/v1/flags/flag-1/bearer')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    acceptedTerms = true;
    await request(server)
      .put('/api/v1/flags/flag-1/follow')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'follow-terms')
      .expect(200);
    expect(service.follow).toHaveBeenCalledWith(
      'flag-1',
      'user-1',
      'follow-terms',
    );
  });

  it('약관 화면 배포 전에는 기존 앱의 쓰기 요청을 유지한다', async () => {
    acceptedTerms = false;
    process.env.CURRENT_TERMS_ENFORCED = 'false';
    try {
      await request(server)
        .put('/api/v1/flags/flag-1/follow')
        .set('Authorization', `Bearer ${await accessToken()}`)
        .set('Idempotency-Key', 'follow-rollout')
        .expect(200);
      expect(service.follow).toHaveBeenCalledTimes(1);
    } finally {
      process.env.CURRENT_TERMS_ENFORCED = 'true';
    }
  });

  it('기수 코드 등록도 약관 동의 전에는 거부하고 동의 후 허용한다', async () => {
    const token = await accessToken();
    const claim = () =>
      request(server)
        .post('/api/v1/bearer/claim')
        .set('Authorization', `Bearer ${token}`)
        .send({ festivalId: 'fst-1', code: 'ABC234' });
    acceptedTerms = false;
    const denied = await claim().expect(403);
    expect((denied.body as { code: string }).code).toBe('TERMS_REQUIRED');
    expect(service.claim).not.toHaveBeenCalled();
    acceptedTerms = true;
    await claim().expect(200);
    expect(service.claim).toHaveBeenCalledTimes(1);
  });

  it('관리자 권한이 없는 사용자 JWT는 관리자 코드 목록을 거부한다', async () => {
    await request(server)
      .get('/api/v1/admin/festivals/festival-1/bearer-codes')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .expect(403);
    expect(service.listCodes).not.toHaveBeenCalled();
  });

  it('viewer JWT는 코드 생성을 거부하고 editor JWT는 허용한다', async () => {
    const token = await accessToken();
    const create = () =>
      request(server)
        .post('/api/v1/admin/festivals/festival-1/bearer-codes')
        .set('Authorization', `Bearer ${token}`)
        .set('Origin', 'https://admin.example.com')
        .send({ count: 1 });
    adminAuth.findActiveByUserId.mockResolvedValueOnce({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'viewer',
    });
    await create().expect(403);
    expect(service.createCodes).not.toHaveBeenCalled();

    adminAuth.findActiveByUserId.mockResolvedValueOnce({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'editor',
    });
    const response = await create().expect(201);
    expect((response.body as { data: unknown }).data).toEqual({ codes: [] });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.createCodes).toHaveBeenCalledWith(
      'festival-1',
      { count: 1 },
      'admin-1',
    );
  });
});
