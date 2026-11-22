import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { AdminFestival } from '../src/modules/admin/festival/festival.entity';
import { User } from '../src/modules/auth/entity/user.entity';
import { DeviceAuthGuard } from '../src/modules/device/device-auth.guard';
import { DeviceController } from '../src/modules/device/device.controller';
import {
  Device,
  DeviceSubscription,
} from '../src/modules/device/device.entity';
import { DeviceService } from '../src/modules/device/device.service';
import { LiveActivityService } from '../src/modules/notification/live-activity.service';
import { FakeRepository } from './fake-repository';

/** DeviceService가 쓰는 insert만 더한다. 같은 id면 Postgres 고유 위반(23505)을 흉내낸다. */
class FakeDeviceRepository extends FakeRepository<Device> {
  insert(values: Device): Promise<void> {
    if (this.rows.some((row) => row.id === values.id))
      return Promise.reject(Object.assign(new Error('dup'), { code: '23505' }));
    this.rows.push({ ...values });
    return Promise.resolve();
  }
}

const secret = 'test-access-secret';
const userId = '00000000-0000-4000-8000-000000000001';

/** 현재 iOS 앱이 보내는 본문(.spec/devices.md). platform · fcmToken 키가 없다. */
const iosBody = {
  apnsToken: null,
  apnsEnvironment: 'sandbox',
  liveActivityPushToStartToken: null,
  appVersion: '1.0.0',
  osVersion: '18.0',
  locale: 'ko-KR',
  timezone: 'Asia/Seoul',
};
const androidBody = {
  platform: 'android',
  fcmToken: 'fcm-registration-token',
  appVersion: '1.0.0',
  osVersion: '15',
  locale: 'ko-KR',
  timezone: 'Asia/Seoul',
};

describe('Devices HTTP contract (platform)', () => {
  let app: INestApplication;
  let server: Server;
  let userToken: string;
  const devices = new FakeDeviceRepository();
  const liveActivity = { endDeviceForUnbind: jest.fn() };
  const manager = {
    update: (_: unknown, where: Record<string, unknown>, values: object) =>
      devices.update(where, values),
    findOne: (_: unknown, options: { where: Record<string, unknown> }) =>
      devices.findOne(options),
    query: jest.fn().mockResolvedValue([]),
  };
  const dataSource = {
    transaction: (work: (m: typeof manager) => Promise<unknown>) =>
      work(manager),
  };

  type Body = {
    code: string;
    data: Record<string, unknown> & { deviceAccessToken: string };
  };
  const body = (response: request.Response) => response.body as Body;
  const row = (id: string) =>
    devices.rows.find((item) => item.id === id) as Device;
  const put = (id: string, body: object, token?: string) => {
    const req = request(server).put('/api/v1/devices').set('X-Device-Id', id);
    if (token) req.auth(token, { type: 'bearer' });
    return req.send(body);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [DeviceController],
      providers: [
        DeviceService,
        DeviceAuthGuard,
        { provide: ConfigService, useValue: { get: () => secret } },
        { provide: getRepositoryToken(Device), useValue: devices },
        {
          provide: getRepositoryToken(DeviceSubscription),
          useValue: { find: () => Promise.resolve([]) },
        },
        { provide: getRepositoryToken(AdminFestival), useValue: {} },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: () => Promise.resolve({ id: userId, provider: 'google' }),
          },
        },
        { provide: DataSource, useValue: dataSource },
        { provide: LiveActivityService, useValue: liveActivity },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // main.ts와 같은 옵션
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0);
    server = app.getHttpServer() as Server;
    userToken = await moduleRef
      .get(JwtService)
      .signAsync(
        { sub: userId, provider: 'google', typ: 'access' },
        { secret },
      );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    devices.rows.length = 0;
    liveActivity.endDeviceForUnbind.mockResolvedValue(undefined);
  });

  it('현재 iOS 요청(platform 생략)은 그대로 200이고 응답 모양이 같다', async () => {
    const id = randomUUID();
    const response = await put(id, iosBody).expect(200);
    expect(body(response).code).toBe('SUCCESS');
    expect(Object.keys(body(response).data).sort()).toEqual([
      'deviceAccessToken',
      'deviceId',
      'subscriptions',
      'userId',
    ]);
    expect(row(id)).toMatchObject({
      platform: 'ios',
      apnsEnvironment: 'sandbox',
    });
    expect(row(id)).not.toHaveProperty('fcmToken');
    const token = body(response).data.deviceAccessToken;
    await put(id, { ...iosBody, apnsToken: 'ab'.repeat(32) }, token).expect(
      200,
    );
    await put(id, { ...iosBody, platform: 'ios' }, token).expect(200);
  });

  it('iOS fcmToken은 null이면 200, 문자열이면 400', async () => {
    await put(randomUUID(), { ...iosBody, fcmToken: null }).expect(200);
    const response = await put(randomUUID(), {
      ...iosBody,
      fcmToken: 'x',
    }).expect(400);
    expect((response.body as { data: unknown }).data).toBeNull();
    expect(devices.rows).toHaveLength(1);
  });

  it('Android 정상 등록은 200이고 FCM 토큰만 저장한다', async () => {
    const id = randomUUID();
    const response = await put(id, androidBody).expect(200);
    expect(body(response).data).toMatchObject({ deviceId: id, userId: null });
    expect(row(id)).toMatchObject({
      platform: 'android',
      fcmToken: 'fcm-registration-token',
      apnsToken: null,
      apnsEnvironment: null,
      liveActivityPushToStartToken: null,
    });
    const token = body(response).data.deviceAccessToken;
    const status = await request(server)
      .get('/api/v1/devices')
      .set('X-Device-Id', id)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(body(status).data).toMatchObject({
      platform: 'android',
      apnsEnvironment: null,
    });
    expect(body(status).data).not.toHaveProperty('fcmToken');
  });

  it('Android fcmToken은 null이면 200, 키가 없으면 400', async () => {
    const id = randomUUID();
    await put(id, { ...androidBody, fcmToken: null }).expect(200);
    expect(row(id).fcmToken).toBeNull();
    const { fcmToken, ...missing } = androidBody;
    void fcmToken;
    await put(randomUUID(), missing).expect(400);
    expect(devices.rows).toHaveLength(1);
  });

  it.each([
    ['apnsToken', 'ab'.repeat(32)],
    ['apnsEnvironment', 'production'],
    ['liveActivityPushToStartToken', 'cd'.repeat(32)],
  ])('Android에 non-null %s가 있으면 400', async (key, value) => {
    await put(randomUUID(), { ...androidBody, [key]: value }).expect(400);
    expect(devices.rows).toHaveLength(0);
  });

  it('등록된 기기의 플랫폼 변경은 403이다', async () => {
    const id = randomUUID();
    const first = await put(id, iosBody).expect(200);
    const token = body(first).data.deviceAccessToken;
    await put(id, androidBody, token).expect(403);
    expect(row(id)).toMatchObject({
      platform: 'ios',
      apnsEnvironment: 'sandbox',
    });

    const androidId = randomUUID();
    const second = await put(androidId, androidBody).expect(200);
    const androidToken = body(second).data.deviceAccessToken;
    await put(androidId, iosBody, androidToken).expect(403);
    expect(row(androidId)).toMatchObject({
      platform: 'android',
      fcmToken: 'fcm-registration-token',
    });
  });

  it('연결 해제는 fcmToken도 지운다', async () => {
    const id = randomUUID();
    const registered = await put(id, androidBody).expect(200);
    const deviceToken = body(registered).data.deviceAccessToken;
    await request(server)
      .put('/api/v1/devices/bind-user')
      .set('X-Device-Id', id)
      .set('X-Device-Access-Token', deviceToken)
      .auth(userToken, { type: 'bearer' })
      .expect(200);
    expect(row(id).userId).toBe(userId);
    await request(server)
      .delete('/api/v1/devices/bind-user')
      .set('X-Device-Id', id)
      .set('X-Device-Unbind-Key', randomUUID())
      .auth(userToken, { type: 'bearer' })
      .expect(200);
    expect(row(id)).toMatchObject({ userId: null, fcmToken: null });
  });
});
