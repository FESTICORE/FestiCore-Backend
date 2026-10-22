import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, TestContext } from './app-factory';

describe('Public legal pages (e2e)', () => {
  let ctx: TestContext;
  let server: App;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as App;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it.each(['home', 'privacy', 'terms'])(
    'serves %s without authentication as HTML',
    async (name) => {
      const response = await request(server)
        .get(`/api/v1/legal/${name}`)
        .expect(200);

      expect(response.headers['content-type']).toMatch(/^text\/html/);
      expect(response.headers['cache-control']).toBe('public, max-age=3600');
      expect(response.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      expect(response.text).toContain('패스티코어');
      expect(response.text).toContain('/api/v1/legal/privacy');
      expect(response.text).toContain('/api/v1/legal/terms');
    },
  );
});
