import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { CrawlService } from '../service/crawl.service';
import { CrawlController } from './crawl.controller';

describe('admin crawl image throttling', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [CrawlController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        {
          provide: CrawlService,
          useValue: {
            image: jest.fn().mockResolvedValue(Buffer.from('RIFF0000WEBPtest')),
            images: jest.fn().mockResolvedValue({ items: [] }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => app.close());

  it('allows repeated 100-image galleries while enforcing the image limit', async () => {
    const server = app.getHttpServer() as import('http').Server;
    for (let index = 0; index < 600; index += 1) {
      await request(server)
        .get('/api/v1/admin/crawl/images/123e4567-e89b-42d3-a456-426614174000')
        .expect(200)
        .expect('Cache-Control', 'private, max-age=300');
    }
    await request(server)
      .get('/api/v1/admin/crawl/images/123e4567-e89b-42d3-a456-426614174000')
      .expect(429);
  });

  it('keeps the global limit for the image metadata endpoint', async () => {
    const server = app.getHttpServer() as import('http').Server;
    for (let index = 0; index < 100; index += 1) {
      await request(server).get('/api/v1/admin/crawl/images').expect(200);
    }
    await request(server).get('/api/v1/admin/crawl/images').expect(429);
  });
});
