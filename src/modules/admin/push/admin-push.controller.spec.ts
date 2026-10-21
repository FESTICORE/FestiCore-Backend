import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Server } from 'node:http';
import request from 'supertest';
import { ResponseInterceptor } from '../../../common/interceptors/response.interceptor';
import { ADMIN_ROLES_KEY } from '../auth/admin-roles.decorator';
import { AdminPushController } from './admin-push.controller';
import { AdminPushService } from './admin-push.service';

jest.mock('../../notification/apns.service', () => ({ ApnsService: class {} }));

const DEVICE_ID = '1f0d7050-9b11-4099-84b5-7d71e31f8850';

describe('AdminPushController', () => {
  let app: INestApplication;
  const sendTest = jest.fn().mockResolvedValue({
    deviceId: DEVICE_ID,
    type: 'pack.updated',
    accepted: true,
    reason: null,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminPushController],
      providers: [{ provide: AdminPushService, useValue: { sendTest } }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => sendTest.mockClear());

  it('declares editor access and returns the common response envelope', async () => {
    const handler = Object.getOwnPropertyDescriptor(
      AdminPushController.prototype,
      'sendTest',
    )?.value as object;
    const roles: unknown = Reflect.getMetadata(ADMIN_ROLES_KEY, handler);
    expect(roles).toEqual(['editor']);
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/push/test')
      .send({ deviceId: DEVICE_ID, type: 'pack.updated' })
      .expect(201);
    expect(response.body).toMatchObject({
      code: 'SUCCESS',
      data: { deviceId: DEVICE_ID, type: 'pack.updated', accepted: true },
    });
    expect(sendTest).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid types, device IDs, and caller supplied tokens', async () => {
    for (const body of [
      { deviceId: DEVICE_ID, type: 'arbitrary' },
      { deviceId: 'not-a-uuid', type: 'pack.updated' },
      { deviceId: DEVICE_ID, type: 'pack.updated', apnsToken: 'caller-token' },
    ]) {
      await request(app.getHttpServer() as Server)
        .post('/api/v1/admin/push/test')
        .send(body)
        .expect(400);
    }
    expect(sendTest).not.toHaveBeenCalled();
  });

  it('documents the body and common response in admin Swagger', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Admin').setVersion('1').build(),
    );
    const operation = document.paths['/api/v1/admin/push/test']?.post;
    expect(operation).toBeDefined();
    expect(operation?.requestBody).toBeDefined();
    expect(JSON.stringify(operation?.responses['201'])).toContain('SUCCESS');
  });
});
