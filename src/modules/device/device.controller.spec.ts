import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';

describe('기기 API 경로와 헤더 계약', () => {
  let app: INestApplication;
  const service = {
    optionalUser: jest.fn().mockResolvedValue(null),
    register: jest.fn().mockResolvedValue({ deviceId: 'device-id' }),
    startLiveActivity: jest.fn().mockResolvedValue(undefined),
    stopLiveActivity: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue({
      festivalId: 'fst_test',
      packUpdates: true,
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DeviceController],
      providers: [{ provide: DeviceService, useValue: service }],
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
      appVersion: '1.0.0',
      osVersion: '18.0',
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
    };
    await request(app.getHttpServer() as App)
      .put('/api/v1/devices')
      .set('X-Device-Id', 'header-device')
      .set('X-Device-Secret', 'secret')
      .send(body)
      .expect(200);
    expect(service.register).toHaveBeenCalledWith(
      'header-device',
      body,
      null,
      'secret',
    );
    await request(app.getHttpServer() as App)
      .put('/api/v1/devices/path-device')
      .send(body)
      .expect(404);
  });

  it('구독 대상 축제 ID와 헤더의 기기 ID를 분리한다', async () => {
    await request(app.getHttpServer() as App)
      .put('/api/v1/devices/subscriptions/fst_test')
      .set('X-Device-Id', 'header-device')
      .set('X-Device-Secret', 'secret')
      .send({ packUpdates: true })
      .expect(200);
    expect(service.subscribe).toHaveBeenCalledWith(
      'header-device',
      'fst_test',
      { packUpdates: true },
      null,
      'secret',
    );
  });

  it('Swagger에 헤더를 중복 표기하거나 deviceId 경로 변수를 남기지 않는다', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Devices').setVersion('1').build(),
    );
    const paths = Object.keys(document.paths);
    expect(paths).toContain('/api/v1/devices');
    expect(paths).toContain('/api/v1/devices/subscriptions/{festivalId}');
    expect(paths.some((path) => path.includes('{deviceId}'))).toBe(false);
    for (const path of paths) {
      for (const method of ['put', 'delete'] as const) {
        const operation = document.paths[path][method];
        if (!operation) continue;
        const parameters = operation.parameters ?? [];
        for (const name of [
          'X-Device-Id',
          'X-Device-Secret',
          'Authorization',
        ]) {
          expect(
            parameters.filter(
              (param) => 'name' in param && param.name === name,
            ),
          ).toHaveLength(1);
        }
      }
    }
  });
});
