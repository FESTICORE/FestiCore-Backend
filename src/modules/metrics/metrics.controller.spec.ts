import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  let app: INestApplication;
  const ingest = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [{ provide: MetricsService, useValue: { ingest } }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterAll(async () => app.close());

  it('returns an empty 202 despite the global response envelope', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/metrics/events')
      .set('X-Device-Id', '1f0d7050-9b11-4099-84b5-7d71e31f8850')
      .send({ events: [] })
      .expect(202);
    expect(response.text).toBe('');
    expect(ingest).toHaveBeenCalledWith(
      '1f0d7050-9b11-4099-84b5-7d71e31f8850',
      { events: [] },
    );
  });
});
