import { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { CrawlController } from '../src/modules/admin/crawl/controller/crawl.controller';
import { CrawlService } from '../src/modules/admin/crawl/service/crawl.service';

describe('Admin crawl image HTTP (e2e)', () => {
  let app: INestApplication;
  let server: App;
  const crawl = { image: jest.fn() };
  const imageId = '7b9251a1-0d15-46da-93a6-fb51d8136452';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CrawlController],
      providers: [
        { provide: CrawlService, useValue: crawl },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.listen(0);
    server = app.getHttpServer() as App;
  });

  afterAll(async () => app.close());

  it('returns raw WebP bytes through the global response interceptor', async () => {
    const bytes = Buffer.from('524946460400000057454250', 'hex');
    crawl.image.mockResolvedValueOnce(bytes);

    const response = await request(server)
      .get(`/api/v1/admin/crawl/images/${imageId}`)
      .expect(200);

    expect(response.headers['content-type']).toMatch(/^image\/webp/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toEqual(bytes);
    expect(crawl.image).toHaveBeenCalledWith(imageId);
  });
});
