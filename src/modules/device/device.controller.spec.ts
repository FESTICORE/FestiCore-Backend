import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';
import { NotificationSubscriptionController } from './notification-subscription.controller';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { User } from '../auth/entity/user.entity';
import { Device } from './device.entity';
import { DeviceAuthGuard } from './device-auth.guard';

describe('기기 API 경로와 헤더 계약', () => {
  let app: INestApplication;
  const verifyAsync = jest.fn((token: string) => {
    if (token === 'device-valid')
      return Promise.resolve({
        sub: 'device-a',
        jti: 'token-a',
        typ: 'device',
      });
    if (token !== 'valid') return Promise.reject(new Error('invalid'));
    return Promise.resolve({
      sub: 'user-a',
      typ: 'access',
      provider: 'google',
    });
  });
  const storedDevice = { findOne: jest.fn().mockResolvedValue(null) };
  const service = {
    register: jest.fn().mockResolvedValue({ deviceId: 'device-id' }),
    get: jest.fn().mockResolvedValue({ deviceId: 'device-id' }),
    remove: jest.fn().mockResolvedValue(undefined),
    startLiveActivity: jest.fn().mockResolvedValue(undefined),
    stopLiveActivity: jest.fn().mockResolvedValue(undefined),
    listSubscriptions: jest.fn().mockResolvedValue({ items: [] }),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue({
      festivalId: 'fst_test',
      packUpdates: true,
      festivalStarts: true,
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DeviceController, NotificationSubscriptionController],
      providers: [
        { provide: DeviceService, useValue: service },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        DeviceAuthGuard,
        { provide: JwtService, useValue: { verifyAsync } },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: () =>
              Promise.resolve({ id: 'user-a', provider: 'google' }),
          },
        },
        {
          provide: getRepositoryToken(Device),
          useValue: storedDevice,
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('헤더의 기기 ID로 등록하고 경로의 기기 ID는 사용하지 않는다', async () => {
    const body = {
      apnsToken: null,
      apnsEnvironment: 'sandbox',
      appVersion: '1.0.0',
      osVersion: '18.0',
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
    };
    await request(app.getHttpServer() as App)
      .put('/api/v1/devices')
      .set('X-Device-Id', 'header-device')
      .set('Authorization', 'Bearer valid')
      .send(body)
      .expect(200);
    expect(service.register).toHaveBeenCalledWith('header-device', body, {
      kind: 'user',
      userId: 'user-a',
    });
    await request(app.getHttpServer() as App)
      .put('/api/v1/devices/path-device')
      .send(body)
      .expect(404);
  });

  it('구독 대상 축제 ID와 헤더의 기기 ID를 분리한다', async () => {
    await request(app.getHttpServer() as App)
      .put('/api/v1/notifications/subscriptions/fst_test')
      .set('X-Device-Id', 'header-device')
      .set('Authorization', 'Bearer valid')
      .send({ pinned: true, packUpdates: true, festivalStarts: true })
      .expect(200);
    expect(service.subscribe).toHaveBeenCalledWith(
      'header-device',
      'fst_test',
      { pinned: true, packUpdates: true, festivalStarts: true },
      { kind: 'user', userId: 'user-a' },
    );
    await request(app.getHttpServer() as App)
      .put('/api/v1/devices/subscriptions/fst_test')
      .send({ packUpdates: true, festivalStarts: true })
      .expect(404);
  });

  it('Swagger에 헤더를 중복 표기하거나 deviceId 경로 변수를 남기지 않는다', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Devices')
        .setVersion('1')
        .addBearerAuth()
        .build(),
    );
    const paths = Object.keys(document.paths);
    expect(paths).toContain('/api/v1/devices');
    expect(paths).toContain('/api/v1/notifications/subscriptions/{festivalId}');
    expect(paths.some((path) => path.includes('{deviceId}'))).toBe(false);
    for (const path of paths) {
      for (const method of ['get', 'put', 'delete'] as const) {
        const operation = document.paths[path][method];
        if (!operation) continue;
        const parameters = operation.parameters ?? [];
        for (const name of ['X-Device-Id']) {
          expect(
            parameters.filter(
              (param) => 'name' in param && param.name === name,
            ),
          ).toHaveLength(1);
        }
        expect(
          parameters.some(
            (param) => 'name' in param && param.name === 'X-Device-Secret',
          ),
        ).toBe(false);
        expect(operation.security).toEqual([{ bearer: [] }]);
      }
    }
  });

  it('rejects missing and invalid Bearer tokens on every device route', async () => {
    const routes = [
      ['get', '/api/v1/devices'],
      ['delete', '/api/v1/devices'],
      ['put', '/api/v1/devices/live-activity'],
      ['delete', '/api/v1/devices/live-activity'],
      ['get', '/api/v1/notifications/subscriptions'],
      ['put', '/api/v1/notifications/subscriptions/fst_test'],
      ['delete', '/api/v1/notifications/subscriptions/fst_test'],
    ] as const;
    for (const [method, path] of routes) {
      await request(app.getHttpServer() as App)
        [method](path)
        .expect(401);
      await request(app.getHttpServer() as App)
        [method](path)
        .set('Authorization', 'Bearer invalid')
        .expect(401);
    }
    await request(app.getHttpServer() as App)
      .put('/api/v1/devices')
      .set('X-Device-Id', 'new-device')
      .send({})
      .expect(200);
  });

  it('binds an anonymous device Bearer to the stored device and header ID', async () => {
    storedDevice.findOne.mockResolvedValue({
      id: 'device-a',
      deviceTokenId: 'token-a',
    });
    await request(app.getHttpServer() as App)
      .get('/api/v1/devices')
      .set('X-Device-Id', 'device-b')
      .set('Authorization', 'Bearer device-valid')
      .expect(401);
    await request(app.getHttpServer() as App)
      .get('/api/v1/devices')
      .set('X-Device-Id', 'device-a')
      .set('Authorization', 'Bearer device-valid')
      .expect(200);
    expect(service.get).toHaveBeenCalledWith('device-a', {
      kind: 'device',
      deviceId: 'device-a',
      tokenId: 'token-a',
    });
  });
});
