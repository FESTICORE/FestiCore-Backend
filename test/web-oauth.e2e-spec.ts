import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { WebOauthController } from '../src/modules/auth/controller/web-oauth.controller';
import { WebOauthService } from '../src/modules/auth/web/web-oauth.service';

describe('Web OAuth callback (e2e)', () => {
  let app: INestApplication;
  let server: App;
  const oauth = {
    begin: jest.fn().mockResolvedValue({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?state=s',
      browserToken: 'browser',
    }),
    finish: jest.fn().mockResolvedValue('ticket'),
    consumeTicket: jest
      .fn()
      .mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    redirectUri: jest
      .fn()
      .mockReturnValue(
        'https://festicore-dev.up.railway.app/api/v1/auth/google/callback',
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
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer() as App;
  });

  afterEach(async () => app.close());

  it('starts, callbacks, sends result to fixed popup origin, and exchanges once', async () => {
    const start = await request(server)
      .get('/api/v1/auth/google/start')
      .expect(302);
    expect(start.headers.location).toContain('accounts.google.com');
    const browserCookie = (
      start.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const callback = await request(server)
      .get('/api/v1/auth/google/callback?code=code&state=state')
      .set('Cookie', browserCookie)
      .expect(303);
    expect(oauth.finish).toHaveBeenCalledWith(
      'google',
      'code',
      'state',
      'browser',
      undefined,
    );
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
    await request(server)
      .post('/api/v1/auth/web/token')
      .set('Origin', 'https://festicore-dev.up.railway.app')
      .set('Cookie', ticketCookie)
      .expect(201)
      .expect({ accessToken: 'access', refreshToken: 'refresh' });
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
    await request(server)
      .post('/api/v1/auth/apple/callback')
      .type('form')
      .send({ code: 'code', state: 'state', user: 'x'.repeat(2049) })
      .expect(400);
    expect(oauth.finish).toHaveBeenCalledTimes(1);
  });
});
