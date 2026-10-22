import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../auth/decorator/public.decorator';
import { LegalController } from './legal.controller';

describe('public legal pages', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LegalController],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => app.close());

  it.each(['about', 'legal/privacy', 'legal/terms'])(
    'serves %s as public HTML without an access token',
    async (path) => {
      const response = await request(
        app.getHttpServer() as import('http').Server,
      )
        .get(`/api/v1/${path}`)
        .expect(200);
      expect(response.headers['content-type']).toMatch(/^text\/html/);
      expect(response.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      expect(response.text).toContain('lang="ko"');
      expect(response.text).toContain('href="/api/v1/legal/privacy"');
      expect(response.text).toContain('href="/api/v1/legal/terms"');
    },
  );

  it('marks the controller public for the global JWT guard', () => {
    const reflector = new Reflector();
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, LegalController)).toBe(true);
  });
});
