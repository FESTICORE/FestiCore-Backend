import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminSessionGuard } from './admin-session.guard';

describe('admin account HTTP access', () => {
  let app: INestApplication;
  const auth = { validateSession: jest.fn() };
  const accounts = {
    list: jest.fn().mockResolvedValue({ items: [] }),
    invite: jest.fn().mockResolvedValue({ id: 'admin-id' }),
    disable: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAccountsController],
      providers: [
        AdminSessionGuard,
        { provide: APP_GUARD, useExisting: AdminSessionGuard },
        { provide: AdminAuthService, useValue: auth },
        { provide: AdminAccountsService, useValue: accounts },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'ADMIN_WEB_URL' ? 'https://admin.example.com' : undefined,
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

  afterAll(async () => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    auth.validateSession.mockResolvedValue({
      id: 'owner-id',
      email: 'owner@example.com',
      role: 'owner',
    });
  });

  const path = '/api/v1/admin/admins';
  const cookie = 'festicore_admin_session=abc';

  it('requires a session and rejects editor access', async () => {
    await request(app.getHttpServer() as Server)
      .get(path)
      .expect(401);
    auth.validateSession.mockResolvedValue({
      id: 'editor-id',
      email: 'editor@example.com',
      role: 'editor',
    });
    await request(app.getHttpServer() as Server)
      .get(path)
      .set('Cookie', cookie)
      .expect(403);
    expect(accounts.list).not.toHaveBeenCalled();
  });

  it('allows an owner and validates invite input', async () => {
    await request(app.getHttpServer() as Server)
      .get(path)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer() as Server)
      .post(`${path}/invite`)
      .set('Cookie', cookie)
      .set('Origin', 'https://admin.example.com')
      .send({ email: 'bad-address', role: 'owner' })
      .expect(400);
    expect(accounts.invite).not.toHaveBeenCalled();
    await request(app.getHttpServer() as Server)
      .post(`${path}/invite`)
      .set('Cookie', cookie)
      .set('Origin', 'https://admin.example.com')
      .send({ email: 'new@example.com', role: 'viewer' })
      .expect(201);
    expect(accounts.invite).toHaveBeenCalledWith(
      'owner-id',
      'new@example.com',
      'viewer',
      expect.any(String),
    );
  });

  it('rejects cross-site writes and malformed IDs', async () => {
    await request(app.getHttpServer() as Server)
      .delete(`${path}/f4e43e16-c8e3-4afd-a09d-123011d23b91`)
      .set('Cookie', cookie)
      .set('Origin', 'https://other.example.com')
      .expect(403);
    await request(app.getHttpServer() as Server)
      .delete(`${path}/not-a-uuid`)
      .set('Cookie', cookie)
      .set('Origin', 'https://admin.example.com')
      .expect(400);
    expect(accounts.disable).not.toHaveBeenCalled();
  });
});
