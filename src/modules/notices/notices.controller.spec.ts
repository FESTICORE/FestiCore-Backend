import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Server } from 'node:http';
import request from 'supertest';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { User } from '../auth/entity/user.entity';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { AdminAuthService } from '../admin/auth/admin-auth.service';
import { AdminSessionGuard } from '../admin/auth/admin-session.guard';
import { AdminNoticesController } from './admin-notices.controller';
import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';

const id = '2c75c8de-517d-4611-9c51-b4ff804dd597';
const publishedAt = '2026-11-04T00:00:00.000Z';
const notice = {
  id,
  title: '안내',
  content: '공지 본문',
  published: true,
  publishedAt,
  createdAt: publishedAt,
  updatedAt: publishedAt,
};

describe('공지사항 HTTP 계약', () => {
  let app: INestApplication;
  let role: 'viewer' | 'editor' = 'editor';
  const notices = {
    publicList: jest.fn().mockResolvedValue({
      items: [{ id, title: notice.title, publishedAt }],
    }),
    publicDetail: jest.fn().mockResolvedValue({
      id,
      title: notice.title,
      content: notice.content,
      publishedAt,
    }),
    adminList: jest.fn().mockResolvedValue({ items: [notice] }),
    adminDetail: jest.fn().mockResolvedValue(notice),
    create: jest.fn().mockResolvedValue(notice),
    update: jest.fn().mockResolvedValue(notice),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [NoticesController, AdminNoticesController],
      providers: [
        { provide: NoticesService, useValue: notices },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'ADMIN_WEB_URL'
                ? 'https://admin.example.com'
                : 'test-secret',
          },
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: () =>
              Promise.resolve({
                sub: 'account-id',
                provider: 'google',
                typ: 'access',
              }),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: () =>
              Promise.resolve({
                id: 'account-id',
                provider: 'google',
              }),
          },
        },
        {
          provide: AdminAuthService,
          useValue: {
            findActiveByUserId: () => Promise.resolve({ id: 'admin-id', role }),
          },
        },
        JwtAuthGuard,
        AdminSessionGuard,
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        { provide: APP_GUARD, useExisting: AdminSessionGuard },
      ],
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
  beforeEach(() => {
    jest.clearAllMocks();
    role = 'editor';
  });

  it('공개 목록·상세를 로그인 없이 읽고 공통 응답 형식과 no-store를 사용한다', async () => {
    const list = await request(app.getHttpServer() as Server)
      .get('/api/v1/notices')
      .expect(200);
    expect(list.body).toMatchObject({
      code: 'SUCCESS',
      data: {
        items: [{ id, title: '안내', publishedAt }],
      },
    });
    expect(list.headers['cache-control']).toBe('no-store');
    const detail = await request(app.getHttpServer() as Server)
      .get(`/api/v1/notices/${id}`)
      .expect(200);
    expect(detail.body as unknown).toMatchObject({
      data: { id, content: '공지 본문' },
    });
    expect(detail.headers['cache-control']).toBe('no-store');
    expect(notices.publicDetail).toHaveBeenCalledWith(id);
  });

  it('공개 잘못된 UUID는 404, 관리자 잘못된 UUID는 400이다', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/v1/notices/not-a-uuid')
      .expect(404);
    await request(app.getHttpServer() as Server)
      .get('/api/v1/admin/notices/not-a-uuid')
      .set('Authorization', 'Bearer test')
      .expect(400);
    expect(notices.publicDetail).not.toHaveBeenCalled();
    expect(notices.adminDetail).not.toHaveBeenCalled();
  });

  it('관리자 접근에는 JWT와 editor 권한 및 허용 Origin이 필요하다', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/notices')
      .send({ title: '안내', content: '본문', published: true })
      .expect(401);
    role = 'viewer';
    await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/notices')
      .set('Authorization', 'Bearer test')
      .set('Origin', 'https://admin.example.com')
      .send({ title: '안내', content: '본문', published: true })
      .expect(403);
    role = 'editor';
    await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/notices')
      .set('Authorization', 'Bearer test')
      .send({ title: '안내', content: '본문', published: true })
      .expect(403);
    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/notices')
      .set('Authorization', 'Bearer test')
      .set('Origin', 'https://admin.example.com')
      .send({ title: '안내', content: '본문', published: true })
      .expect(201);
    expect(created.body as unknown).toMatchObject({
      data: { id, published: true },
    });
    expect(created.headers['cache-control']).toBe('no-store');
    expect(notices.create).toHaveBeenCalledWith('admin-id', {
      title: '안내',
      content: '본문',
      published: true,
    });
  });

  it('관리자 목록의 페이지 인자를 서비스에 전달한다', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/admin/notices?limit=2&offset=3')
      .set('Authorization', 'Bearer test')
      .expect(200);
    expect(response.body as unknown).toMatchObject({
      data: { items: [{ id }] },
    });
    expect(notices.adminList).toHaveBeenCalledWith('2', '3');
  });

  it('알 수 없는 필드와 빈 PATCH를 거부하고 없는 공지는 404이다', async () => {
    const url = `/api/v1/admin/notices/${id}`;
    await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/notices')
      .set('Authorization', 'Bearer test')
      .set('Origin', 'https://admin.example.com')
      .send({ title: '안내', content: '본문', published: true, extra: 1 })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .patch(url)
      .set('Authorization', 'Bearer test')
      .set('Origin', 'https://admin.example.com')
      .send({})
      .expect(400);
    notices.adminDetail.mockRejectedValueOnce(new NotFoundException());
    await request(app.getHttpServer() as Server)
      .get(url)
      .set('Authorization', 'Bearer test')
      .expect(404);
    expect(notices.create).not.toHaveBeenCalled();
    expect(notices.update).not.toHaveBeenCalled();
  });

  it('공개·관리자 Swagger 문서에 경로와 응답 예시를 노출한다', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Notices').setVersion('1').build(),
    );
    expect(
      document.paths['/api/v1/notices']?.get?.responses['200'],
    ).toBeDefined();
    expect(
      document.paths['/api/v1/notices/{id}']?.get?.responses['404'],
    ).toBeDefined();
    expect(
      document.paths['/api/v1/admin/notices']?.post?.requestBody,
    ).toBeDefined();
    expect(
      document.paths['/api/v1/admin/notices/{id}']?.patch?.responses['403'],
    ).toBeDefined();
    expect(
      JSON.stringify(document.paths['/api/v1/notices']?.get?.responses['200']),
    ).toContain('SUCCESS');
  });
});
