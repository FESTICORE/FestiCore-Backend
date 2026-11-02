import { Test } from '@nestjs/testing';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { ImageStorageService } from '../storage/image-storage.service';
import { PublicFestivalMapController } from './public-festival-map.controller';
import { PublicFestivalService } from './public-festival.service';

describe('public festival image throttling', () => {
  let app: INestApplication;
  const query = jest.fn();
  const readCrawlImage = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [PublicFestivalMapController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        {
          provide: ImageStorageService,
          useValue: { readCrawlImage, readFestivalMap: jest.fn() },
        },
        { provide: DataSource, useValue: { query } },
        {
          provide: PublicFestivalService,
          useValue: { hasCurrentArtist: jest.fn() },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => app.close());

  it('serves a large lineup of artist images beyond the global API limit', async () => {
    query.mockResolvedValue([
      {
        objectKey: 'crawl/a.webp',
        seed: null,
        festivalId: null,
        festivalSourceUrl: null,
        artistName: null,
      },
    ]);
    readCrawlImage.mockResolvedValue(Buffer.from('RIFF0000WEBPtest'));
    const server = app.getHttpServer() as import('http').Server;
    const statuses: number[] = [];
    for (let index = 0; index < 101; index += 1) {
      const result = await request(server).get(
        '/api/v1/festivals/images/123e4567-e89b-42d3-a456-426614174000.webp',
      );
      statuses.push(result.status);
    }
    expect(statuses.filter((status) => status !== 200)).toEqual([]);
  });
});
