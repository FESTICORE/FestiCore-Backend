import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';

describe('admin callback browser form', () => {
  let app: INestApplication;
  const auth = {
    consumeMagicLink: jest
      .fn()
      .mockResolvedValue({ sessionToken: 'b'.repeat(43) }),
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
});
