import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import helmet from 'helmet';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { WebOauthController } from '../src/modules/auth/controller/web-oauth.controller';
import { WebOauthService } from '../src/modules/auth/web/web-oauth.service';

describe('Web OAuth callback (e2e)', () => {
  let app: INestApplication;
  let server: App;
  const oauth = {
    begin: jest.fn().mockResolvedValue({
      url: 'https://appleid.apple.com/auth/authorize?state=s',
      browserToken: 'browser',
    }),
    finish: jest.fn().mockResolvedValue('ticket'),
    cancel: jest.fn().mockResolvedValue(undefined),
    consumeTicket: jest
      .fn()
      .mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    redirectUri: jest
      .fn()
      .mockReturnValue(
        'https://festicore-dev.up.railway.app/api/v1/auth/apple/callback',
      ),
    clientOrigin: jest.fn().mockReturnValue('https://admin.example.com'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [WebOauthController],
      providers: [{ provide: WebOauthService, useValue: oauth }],
    }).compile();
    app = module.createNestApplication();
    app.use(helmet({ contentSecurityPolicy: false }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer() as App;
  });

  afterEach(async () => app.close());

  it('starts, callbacks, sends result to fixed popup origin, and exchanges once', async () => {
    const start = await request(server)
      .get('/api/v1/auth/apple/start')
      .expect(302);
    expect(start.headers.location).toContain('appleid.apple.com');
    expect(start.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    const browserCookie = (
      start.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const callback = await request(server)
      .post('/api/v1/auth/apple/callback')
      .type('form')
      .send({ code: 'code', state: 'state' })
      .set('Cookie', browserCookie)
      .expect(303);
    expect(oauth.finish).toHaveBeenCalledWith(
      'apple',
      'code',
      'state',
      'browser',
      undefined,
    );
    expect(callback.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    const ticketCookie = (callback.headers['set-cookie'] as unknown as string[])
      .find((cookie) => cookie.startsWith('festicore_web_login_ticket='))!
      .split(';')[0];
    const result = await request(server)
      .get('/api/v1/auth/web/result')
      .expect(200);
    expect(result.text).toContain("fetch('/api/v1/auth/web/token'");
    expect(result.text).toContain('window.opener.postMessage');
    expect(result.text).toContain('https://admin.example.com');
    expect(result.text).not.toContain('accessToken');
    expect(result.headers['content-security-policy']).toContain(
      "script-src 'sha256-",
    );
    expect(result.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    await request(server)
      .post('/api/v1/auth/web/token')
      .set('Origin', 'https://festicore-dev.up.railway.app')
      .set('Cookie', ticketCookie)
      .expect(200)
      .expect({
        code: 'SUCCESS',
        data: { accessToken: 'access', refreshToken: 'refresh' },
        message: '성공적으로 처리되었습니다.',
      });
    expect(oauth.consumeTicket).toHaveBeenCalledWith('ticket');
  });

  it('rejects token exchange from a foreign origin', async () => {
    await request(server)
      .post('/api/v1/auth/web/token')
      .set('Origin', 'https://attacker.example')
      .set('Cookie', 'festicore_web_login_ticket=ticket')
      .expect(401);
    expect(oauth.consumeTicket).not.toHaveBeenCalled();
  });

  it('invalidates provider cancellation and tells the opener without requesting tokens', async () => {
    const apple = await request(server)
      .post('/api/v1/auth/apple/callback')
      .set('Cookie', 'festicore_apple_oauth=browser')
      .type('form')
      .send({ error: 'user_cancelled_authorize', state: 'apple-state' })
      .expect(303);
    expect(apple.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    expect(oauth.cancel).toHaveBeenCalledWith(
      'apple',
      'apple-state',
      'browser',
    );
    const result = await request(server)
      .get('/api/v1/auth/web/result?error=cancelled')
      .expect(200);
    expect(result.text).toContain("error:'cancelled'");
    expect(result.text).not.toContain("fetch('/api/v1/auth/web/token'");
    expect(oauth.finish).not.toHaveBeenCalled();
    expect(oauth.consumeTicket).not.toHaveBeenCalled();
  });

  it('passes bounded first-login Apple name and rejects oversized user data', async () => {
    await request(server)
      .post('/api/v1/auth/apple/callback')
      .set('Cookie', 'festicore_apple_oauth=browser')
      .type('form')
      .send({
        code: 'code',
        state: 'state',
        user: JSON.stringify({ name: { firstName: '길동', lastName: '홍' } }),
      })
      .expect(303);
    expect(oauth.finish).toHaveBeenCalledWith(
      'apple',
      'code',
      'state',
      'browser',
      '길동 홍',
    );
    const invalid = await request(server)
      .post('/api/v1/auth/apple/callback')
      .type('form')
      .send({ code: 'code', state: 'state', user: 'x'.repeat(2049) })
      .expect(400);
    expect(invalid.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    expect(oauth.finish).toHaveBeenCalledTimes(1);
  });
});
