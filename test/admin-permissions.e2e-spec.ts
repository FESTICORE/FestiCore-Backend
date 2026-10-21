import { ForbiddenException, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AdminAccountsController } from '../src/modules/admin/auth/admin-accounts.controller';
import { AdminAccountsService } from '../src/modules/admin/auth/admin-accounts.service';
import { AdminAuthService } from '../src/modules/admin/auth/admin-auth.service';
import { AdminSessionGuard } from '../src/modules/admin/auth/admin-session.guard';
import { User } from '../src/modules/auth/entity/user.entity';
import { JwtAuthGuard } from '../src/modules/auth/guard/jwt-auth.guard';

describe('Admin permissions HTTP (e2e)', () => {
  let app: INestApplication;
  let server: App;
  let jwt: JwtService;
  const accessSecret = 'admin-permissions-test-access-secret';
  const adminAuth = {
    findActiveByUserId: jest.fn(),
  };
  const accounts = {
    list: jest.fn().mockResolvedValue({ items: [] }),
    invite: jest.fn().mockResolvedValue({
      id: 'admin-2',
      email: 'editor@example.com',
      userId: null,
      role: 'editor',
      active: true,
    }),
    disable: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [AdminAccountsController],
      providers: [
        { provide: AdminAuthService, useValue: adminAuth },
        { provide: AdminAccountsService, useValue: accounts },
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
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: 'user-1',
              provider: 'google',
            }),
          },
        },
        JwtAuthGuard,
        AdminSessionGuard,
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

  afterAll(async () => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    adminAuth.findActiveByUserId.mockResolvedValue({
      id: 'admin-1',
      email: 'owner@example.com',
      role: 'owner',
    });
  });

  const token = () =>
    jwt.signAsync(
      { sub: 'user-1', provider: 'google', typ: 'access' },
      { secret: accessSecret },
    );

  it('rejects a legacy admin cookie without an access JWT', async () => {
    await request(server)
      .get('/api/v1/admin/admins')
      .set('Cookie', 'festicore_admin_session=legacy')
      .expect(401);
    expect(adminAuth.findActiveByUserId).not.toHaveBeenCalled();
  });

  it('lets an owner JWT grant by email, then rejects the same JWT after revocation', async () => {
    const access = await token();
    await request(server)
      .post('/api/v1/admin/admins/invite')
      .set('Authorization', `Bearer ${access}`)
      .set('Origin', 'https://admin.example.com')
      .send({ email: 'editor@example.com', role: 'editor' })
      .expect(201);
    expect(accounts.invite).toHaveBeenCalledWith(
      'admin-1',
      'editor@example.com',
      'editor',
    );

    adminAuth.findActiveByUserId.mockRejectedValueOnce(
      new ForbiddenException('관리자 권한이 없습니다.'),
    );
    await request(server)
      .get('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${access}`)
      .expect(403);
  });

  it('rejects a viewer JWT from owner account management', async () => {
    adminAuth.findActiveByUserId.mockResolvedValueOnce({
      id: 'admin-1',
      email: 'viewer@example.com',
      role: 'viewer',
    });
    await request(server)
      .post('/api/v1/admin/admins/invite')
      .set('Authorization', `Bearer ${await token()}`)
      .set('Origin', 'https://admin.example.com')
      .send({ email: 'editor@example.com', role: 'editor' })
      .expect(403);
    expect(accounts.invite).not.toHaveBeenCalled();
  });
});
