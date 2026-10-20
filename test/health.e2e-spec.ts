import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, TestContext } from './app-factory';

/** 헬스체크 e2e. DB 프로브 성공 200 / 실패 503 (Railway 헬스체크 계약). */
describe('Health (e2e)', () => {
  let ctx: TestContext;
  let server: App;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as App;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('DB 정상 → 200 표준 응답', async () => {
    const res = await request(server).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({
      success: true,
      statusCode: 200,
      data: { status: 'ok', db: 'up' },
    });
  });

  it('DB 실패 → 503 표준 에러', async () => {
    ctx.dataSource.query.mockRejectedValueOnce(new Error('down'));
    const res = await request(server).get('/api/v1/health').expect(503);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 503,
      data: null,
    });
  });
});
