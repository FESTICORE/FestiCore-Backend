import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, TestContext } from './app-factory';

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
    expect(result.body).toMatchObject({ data: { nickname: '기존이름' } });
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

  it('DELETE는 확인 문구가 있어야 하며 성공 시 204를 반환한다', async () => {
    await request(server)
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(400);
    await request(server)
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ confirm: 'WRONG' })
      .expect(400);
    const result = await request(server)
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ confirm: 'DELETE' })
      .expect(204);
    expect(result.text).toBe('');
  });
});
