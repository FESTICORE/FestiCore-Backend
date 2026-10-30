import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, TestContext } from './app-factory';
import { CURRENT_TERMS_VERSION } from '../src/modules/auth/terms';

describe('Me API contract (e2e)', () => {
  let ctx: TestContext;
  let server: App;
  let accessToken: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as App;
    ctx.google.verify.mockResolvedValue({
      provider: 'google',
      providerId: 'me-user',
      email: 'me@example.com',
      name: '기존이름',
    });
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ provider: 'google', token: 'id-token' })
      .expect(200);
    accessToken = (login.body as { data: { accessToken: string } }).data
      .accessToken;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('GET은 본문 없이 현재 사용자 정보를 반환한다', async () => {
    const result = await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(result.body).toMatchObject({
      data: {
        nickname: '기존이름',
        nicknameConfirmed: false,
        termsAcceptedAt: null,
        termsVersion: null,
        currentTermsVersion: CURRENT_TERMS_VERSION,
        pushOptIn: false,
      },
    });
  });

  it('가입 정보 한 번에 저장하고 현재 약관 버전과 알림 선택을 조회한다', async () => {
    const response = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        nickname: '페스티',
        acceptTerms: { version: '2026-10' },
        pushOptIn: true,
      })
      .expect(200);
    expect(response.body).toMatchObject({
      data: {
        nickname: '페스티',
        nicknameConfirmed: true,
        termsVersion: '2026-10',
        pushOptIn: true,
      },
    });
    const updated = response.body as { data: { termsAcceptedAt: string } };
    expect(updated.data.termsAcceptedAt).toEqual(expect.any(String));
    const me = await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const current = me.body as {
      data: { termsVersion: string; currentTermsVersion: string };
    };
    expect(current.data.termsVersion).toBe('2026-10');
    expect(current.data.currentTermsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it('약관 동의만으로 소셜 프로필 닉네임을 확정하지 않는다', async () => {
    const response = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ acceptTerms: { version: '2026-10' } })
      .expect(200);
    expect(response.body).toMatchObject({
      data: { nickname: '기존이름', nicknameConfirmed: false },
    });
  });

  it('닉네임을 먼저 정하고 나중에 약관에 동의해도 가입 정보가 확정된다', async () => {
    const nickname = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nickname: '먼저정함' })
      .expect(200);
    expect(nickname.body).toMatchObject({
      data: { nicknameConfirmed: false },
    });
    const terms = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ acceptTerms: { version: '2026-10' } })
      .expect(200);
    expect(terms.body).toMatchObject({
      data: { nickname: '먼저정함', nicknameConfirmed: true },
    });
  });

  it('잘못된 약관 버전은 422로 거부하고 프로필을 변경하지 않는다', async () => {
    const response = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nickname: '바뀌면안됨', acceptTerms: { version: 'old' } })
      .expect(422);
    const error = response.body as { code: string };
    expect(error.code).toBe('TERMS_VERSION_OUTDATED');
    const me = await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const current = me.body as { data: { nickname: string } };
    expect(current.data.nickname).toBe('기존이름');
  });

  it('PATCH는 닉네임 1~12자만 허용한다', async () => {
    await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nickname: '1234567890123' })
      .expect(400);
    const result = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nickname: '새이름' })
      .expect(200);
    expect(result.body).toMatchObject({ data: { nickname: '새이름' } });
  });

  it('DELETE는 본문 없이 탈퇴하고 기존 access 토큰을 거부한다', async () => {
    await request(server).delete('/api/v1/me').expect(401);
    const result = await request(server)
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
    expect(result.text).toBe('');

    await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });
});
