import express from 'express';
import type { RequestHandler } from 'express';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';

jest.mock('@nestjs/core', () => ({ NestFactory: { create: jest.fn() } }));
jest.mock('./gateway/public-websocket.adapter', () => ({
  PublicWebSocketAdapter: class {},
}));
jest.mock('./app.module', () => ({ AppModule: class {} }));
jest.mock('./swagger', () => ({ setupSwagger: jest.fn() }));

describe('Railway client IP', () => {
  it('uses X-Real-IP and ignores forged X-Forwarded-For', async () => {
    const expressApp = express();
    const app = {
      get: jest.fn().mockReturnValue({
        get: (key: string) =>
          new Map([
            ['RAILWAY_ENVIRONMENT', 'production'],
            ['NODE_ENV', 'production'],
          ]).get(key),
      }),
      getHttpAdapter: () => ({ getInstance: () => expressApp }),
      setGlobalPrefix: jest.fn(),
      useWebSocketAdapter: jest.fn(),
      use: (middleware: RequestHandler) => expressApp.use(middleware),
      useGlobalPipes: jest.fn(),
      enableCors: jest.fn(),
      listen: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(NestFactory, 'create').mockResolvedValue(app as never);

    // Jest executes this CommonJS module after its bootstrap dependency is mocked.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./main');
    await new Promise((resolve) => setImmediate(resolve));
    expressApp.get('/ip', (req, res) => res.json({ ip: req.ip }));

    const trusted = await request(expressApp)
      .get('/ip')
      .set('X-Real-IP', '198.51.100.7')
      .set('X-Forwarded-For', '203.0.113.99');
    expect((trusted.body as { ip: string }).ip).toBe('198.51.100.7');

    const invalid = await request(expressApp)
      .get('/ip')
      .set('X-Real-IP', 'invalid')
      .set('X-Forwarded-For', '203.0.113.99');
    expect((invalid.body as { ip: string }).ip).toMatch(
      /^(::1|::ffff:127\.0\.0\.1)$/,
    );
  });
});
