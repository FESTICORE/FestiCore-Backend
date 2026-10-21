import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { Server } from 'http';
import { JwtAuthGuard } from '../src/modules/auth/guard/jwt-auth.guard';
import { User } from '../src/modules/auth/entity/user.entity';
import { CrewController } from '../src/modules/crews/crew.controller';
import { CrewService } from '../src/modules/crews/crew.service';

const id = 'flg_1234567890abcdef';
const userId = '00000000-0000-4000-8000-000000000001';

describe('Crew HTTP contract', () => {
  let app: INestApplication;
  let server: Server;
  let token: string;
  const service = Object.fromEntries(
    [
      'create',
      'invite',
      'join',
      'detail',
      'rotate',
      'status',
      'gather',
      'rename',
      'renameMember',
      'removeMember',
      'transfer',
      'dissolve',
    ].map((method) => [method, jest.fn().mockResolvedValue({ id })]),
  ) as Record<string, jest.Mock>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [CrewController],
      providers: [
        { provide: CrewService, useValue: service },
        {
          provide: ConfigService,
          useValue: { get: () => 'test-access-secret' },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest
              .fn()
              .mockResolvedValue({ id: userId, provider: 'google' }),
          },
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
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

  it('requires access authentication for all routes except invite preview', async () => {
    await request(server).get(`/api/v1/crews/${id}`).expect(401);
    await request(server)
      .post('/api/v1/crews')
      .send({ festivalId: 'fst_test', name: '친구들' })
      .expect(401);
    await request(server).get('/api/v1/crews/invite/K7P2QX').expect(200);
  });

  it('publishes request bodies and leaves invite preview public in Swagger', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const create = document.paths['/api/v1/crews']?.post;
    const invite = document.paths['/api/v1/crews/invite/{code}']?.get;
    const status = document.paths['/api/v1/crews/{crewId}/status']?.post;
    expect(create?.requestBody).toBeDefined();
    expect(create?.security).toEqual([{ bearer: [] }]);
    expect(invite?.security).toBeUndefined();
    expect(status?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
      ]),
    );
  });

  it('validates and describes create request at runtime', async () => {
    await request(server)
      .post('/api/v1/crews')
      .auth(token, { type: 'bearer' })
      .send({ festivalId: 'fst_test', name: '친구들', role: 'owner' })
      .expect(400);
    await request(server)
      .post('/api/v1/crews')
      .auth(token, { type: 'bearer' })
      .send({ festivalId: 'fst_test', name: '' })
      .expect(400);
    const response = await request(server)
      .post('/api/v1/crews')
      .auth(token, { type: 'bearer' })
      .send({ festivalId: 'fst_test', name: '친구들' })
      .expect(201);
    expect(response.headers.location).toBe(`/api/v1/crews/${id}`);
    expect(service.create).toHaveBeenCalledWith(userId, {
      festivalId: 'fst_test',
      name: '친구들',
    });
  });

  it('rejects malformed join and status bodies, including unknown fields', async () => {
    await request(server)
      .post('/api/v1/crews/join')
      .auth(token, { type: 'bearer' })
      .send({ inviteCode: 'BAD!' })
      .expect(400);
    await request(server)
      .post(`/api/v1/crews/${id}/status`)
      .auth(token, { type: 'bearer' })
      .send({ state: 'here', clientAt: new Date().toISOString() })
      .expect(400);
    await request(server)
      .post(`/api/v1/crews/${id}/status`)
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', 'invalid-date')
      .send({ state: 'here', clientAt: 'no-date' })
      .expect(400);
    await request(server)
      .post(`/api/v1/crews/${id}/status`)
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', 'unknown-field')
      .send({
        state: 'here',
        clientAt: new Date().toISOString(),
        ownerId: userId,
      })
      .expect(400);
    await request(server)
      .post(`/api/v1/crews/${id}/gather`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(400);
    await request(server)
      .post(`/api/v1/crews/${id}/transfer`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(400);
  });

  it('routes create, join, status, gather and ownership actions with the authenticated user', async () => {
    const detail = await request(server)
      .get(`/api/v1/crews/${id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(detail.headers['cache-control']).toBe('no-store');
    await request(server)
      .post('/api/v1/crews/join')
      .auth(token, { type: 'bearer' })
      .send({ inviteCode: 'K7P2QX' })
      .expect(200);
    await request(server)
      .post(`/api/v1/crews/${id}/status`)
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', 'crew-status-001')
      .send({ state: 'here', clientAt: new Date().toISOString() })
      .expect(200);
    await request(server)
      .post(`/api/v1/crews/${id}/gather`)
      .auth(token, { type: 'bearer' })
      .send({ zoneId: 'zon_main' })
      .expect(200);
    await request(server)
      .post(`/api/v1/crews/${id}/invite/rotate`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    await request(server)
      .patch(`/api/v1/crews/${id}`)
      .auth(token, { type: 'bearer' })
      .send({ name: '새 이름' })
      .expect(200);
    await request(server)
      .patch(`/api/v1/crews/${id}/members/me`)
      .auth(token, { type: 'bearer' })
      .send({ nickname: '로이' })
      .expect(200);
    await request(server)
      .post(`/api/v1/crews/${id}/transfer`)
      .auth(token, { type: 'bearer' })
      .send({ toUserId: '00000000-0000-4000-8000-000000000002' })
      .expect(200);
    await request(server)
      .delete(`/api/v1/crews/${id}/members/${userId}`)
      .auth(token, { type: 'bearer' })
      .expect(204);
    await request(server)
      .delete(`/api/v1/crews/${id}`)
      .auth(token, { type: 'bearer' })
      .expect(204);
    expect(service.status).toHaveBeenCalledWith(
      id,
      userId,
      expect.objectContaining({ state: 'here' }),
      'crew-status-001',
    );
    expect(service.detail).toHaveBeenCalledWith(id, userId);
    expect(service.removeMember).toHaveBeenCalledWith(id, userId, userId);
    expect(service.dissolve).toHaveBeenCalledWith(id, userId);
  });
});
