import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, TestContext } from './app-factory';

/** 헬스체크 e2e. Redis는 선택 의존이며 DB 실패만 503이다. */
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

  it('Redis 미설정, DB 정상 → 200 표준 응답', async () => {
    const res = await request(server).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({
      code: 'SUCCESS',
      data: { status: 'ok', db: 'up', redis: 'disabled' },
    });
  });

  it.each(['up', 'down'] as const)(
    'Redis %s → DB 정상일 때 200',
    async (status) => {
      ctx.cache.status.mockResolvedValueOnce(status);
      const res = await request(server).get('/api/v1/health').expect(200);
      expect(res.body).toMatchObject({
        data: { db: 'up', redis: status },
      });
    },
  );

  it('Redis 상태 확인 실패 → DB 정상일 때 200, Redis down', async () => {
    ctx.cache.status.mockRejectedValueOnce(new Error('disconnected'));
    const res = await request(server).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({
      data: { db: 'up', redis: 'down' },
    });
  });

  it('DB 실패 → 503 표준 에러', async () => {
    const redisChecks = ctx.cache.status.mock.calls.length;
    ctx.dataSource.query.mockRejectedValueOnce(new Error('down'));
    const res = await request(server).get('/api/v1/health').expect(503);
    expect(res.body).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      data: null,
    });
    expect(ctx.cache.status).toHaveBeenCalledTimes(redisChecks);
  });
});
