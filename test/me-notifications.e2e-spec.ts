import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { Server } from 'http';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { User } from '../src/modules/auth/entity/user.entity';
import { JwtAuthGuard } from '../src/modules/auth/guard/jwt-auth.guard';
import { UserNotificationController } from '../src/modules/notification/user-notification.controller';
import { UserNotificationService } from '../src/modules/notification/user-notification.service';

const userId = '00000000-0000-4000-8000-000000000001';
const ntf = `ntf_${'a'.repeat(32)}`;

describe('Me notifications HTTP contract', () => {
  let app: INestApplication;
  let server: Server;
  let token: string;
  const service = {
    list: jest.fn(),
    unreadCount: jest.fn(),
    markRead: jest.fn(),
    remove: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [UserNotificationController],
      providers: [
        { provide: UserNotificationService, useValue: service },
        {
          provide: ConfigService,
          useValue: { get: () => 'test-access-secret' },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: () => Promise.resolve({ id: userId, provider: 'google' }),
          },
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0);
    server = app.getHttpServer() as Server;
    token = await moduleRef
      .get(JwtService)
      .signAsync(
        { sub: userId, provider: 'google', typ: 'access' },
        { secret: 'test-access-secret' },
      );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service.markRead.mockResolvedValue(undefined);
    service.remove.mockResolvedValue(undefined);
  });

  it('requires an access token on every route', async () => {
    await request(server).get('/api/v1/me/notifications').expect(401);
    await request(server)
      .get('/api/v1/me/notifications/unread-count')
      .expect(401);
    await request(server)
      .post('/api/v1/me/notifications/read')
      .send({ all: true })
      .expect(401);
    await request(server)
      .post('/api/v1/me/notifications/delete')
      .send({ ids: [ntf] })
      .expect(401);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('lists the caller notifications in the common envelope', async () => {
    const data = {
      items: [{ id: ntf, type: 'crew.gather' }],
      nextCursor: null,
    };
    service.list.mockResolvedValue(data);
    const response = await request(server)
      .get('/api/v1/me/notifications?festivalId=fst_2026&limit=10&before=abc')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(response.body).toMatchObject({ code: 'SUCCESS', data });
    expect(service.list).toHaveBeenCalledWith(userId, {
      festivalId: 'fst_2026',
      before: 'abc',
      limit: '10',
    });
  });

  it('returns the unread count with an ETag and 304 when unchanged', async () => {
    service.unreadCount.mockResolvedValue({ unreadCount: 3 });
    const first = await request(server)
      .get('/api/v1/me/notifications/unread-count?festivalId=fst_2026')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(first.headers.etag).toBe('"unread-3"');
    expect(first.headers['cache-control']).toBe('private, no-cache');
    expect(first.body).toMatchObject({
      code: 'SUCCESS',
      data: { unreadCount: 3 },
    });
    expect(service.unreadCount).toHaveBeenCalledWith(userId, 'fst_2026');
    const second = await request(server)
      .get('/api/v1/me/notifications/unread-count')
      .auth(token, { type: 'bearer' })
      .set('If-None-Match', 'W/"unread-3"')
      .expect(304);
    expect(second.text).toBe('');
    service.unreadCount.mockResolvedValue({ unreadCount: 4 });
    await request(server)
      .get('/api/v1/me/notifications/unread-count')
      .auth(token, { type: 'bearer' })
      .set('If-None-Match', '"unread-3"')
      .expect(200);
  });

  it('marks read with 204 and validates the body', async () => {
    await request(server)
      .post('/api/v1/me/notifications/read')
      .auth(token, { type: 'bearer' })
      .send({ ids: [ntf] })
      .expect(204);
    expect(service.markRead).toHaveBeenCalledWith(userId, { ids: [ntf] });
    await request(server)
      .post('/api/v1/me/notifications/read')
      .auth(token, { type: 'bearer' })
      .send({ all: true, festivalId: 'fst_2026' })
      .expect(204);
    for (const body of [
      { ids: ['ntf_bad'] },
      { ids: [] },
      { all: false },
      { all: true, extra: 1 },
      { all: true, festivalId: 'bad' },
    ])
      await request(server)
        .post('/api/v1/me/notifications/read')
        .auth(token, { type: 'bearer' })
        .send(body)
        .expect(400);
    expect(service.markRead).toHaveBeenCalledTimes(2);
  });

  it('deletes selected ids with 204 and rejects invalid ids', async () => {
    await request(server)
      .post('/api/v1/me/notifications/delete')
      .auth(token, { type: 'bearer' })
      .send({ ids: [ntf] })
      .expect(204);
    expect(service.remove).toHaveBeenCalledWith(userId, { ids: [ntf] });
    await request(server)
      .post('/api/v1/me/notifications/delete')
      .auth(token, { type: 'bearer' })
      .send({ ids: Array.from({ length: 101 }, () => ntf) })
      .expect(400);
    await request(server)
      .post('/api/v1/me/notifications/delete')
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(400);
    expect(service.remove).toHaveBeenCalledTimes(1);
  });
});
