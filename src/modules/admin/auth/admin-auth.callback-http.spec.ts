import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Server } from 'http';
import request from 'supertest';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminSessionGuard } from './admin-session.guard';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { User } from '../../auth/entity/user.entity';

describe('admin callback browser form', () => {
  let app: INestApplication;
  const auth = {
    consumeMagicLink: jest
      .fn()
      .mockResolvedValue({ sessionToken: 'b'.repeat(43) }),
    validateSession: jest.fn(),
  };
  const token = 'a'.repeat(43);
  const values: Record<string, string> = {
    'auth.jwt.accessSecret': 'test-secret',
    ADMIN_WEB_URL: 'https://admin.example.com',
    ADMIN_API_PUBLIC_URL: 'https://api.example.com',
    NODE_ENV: 'test',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAuthController],
      providers: [
        { provide: AdminAuthService, useValue: auth },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn().mockResolvedValue({
              sub: 'user-1',
              provider: 'google',
              typ: 'access',
            }),
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
        { provide: APP_GUARD, useExisting: AdminSessionGuard },
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => values[key],
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts a URL-encoded form with Origin:null and a signed confirmation cookie', async () => {
    const confirmation = await request(app.getHttpServer() as Server)
      .get('/api/v1/admin/auth/callback')
      .query({ token })
      .expect(200);
    expect(auth.consumeMagicLink).not.toHaveBeenCalled();
    expect(confirmation.headers['referrer-policy']).toBe('no-referrer');
    const nonce = /name="csrf" value="([A-Za-z0-9_-]+)"/.exec(
      confirmation.text,
    )?.[1];
    expect(nonce).toBeDefined();
    const cookies = confirmation.headers['set-cookie'] as unknown as string[];
    const csrfCookie = cookies.find((cookie) =>
      cookie.startsWith('festicore_admin_callback='),
    );
    expect(csrfCookie).toBeDefined();

    await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/auth/callback')
      .set('Origin', 'null')
      .set('Cookie', csrfCookie!.split(';')[0])
      .type('form')
      .send({ token, csrf: nonce })
      .expect(303)
      .expect('Location', 'https://admin.example.com/');

    expect(auth.consumeMagicLink).toHaveBeenCalledWith(
      token,
      expect.any(String),
    );
  });

  it('rejects a POST without the confirmation cookie', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/auth/callback')
      .set('Origin', 'null')
      .type('form')
      .send({ token, csrf: 'c'.repeat(43) })
      .expect(403);

    expect(auth.consumeMagicLink).not.toHaveBeenCalled();
  });

  it('rejects app JWTs on case-insensitive admin routes', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/v1/ADMIN/auth/me')
      .set('Authorization', 'Bearer app-jwt')
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/api/v1/ADMIN/auth/logout')
      .set('Authorization', 'Bearer app-jwt')
      .expect(401);
  });
});
