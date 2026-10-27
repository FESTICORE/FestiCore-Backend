import { Test } from '@nestjs/testing';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { ImageStorageService } from '../storage/image-storage.service';
import { DataSource } from 'typeorm';
import { PublicFestivalMapController } from './public-festival-map.controller';

describe('GET festival map image', () => {
  let app: INestApplication;
  const readFestivalMap = jest.fn();
  const readCrawlImage = jest.fn();
  const query = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PublicFestivalMapController],
      providers: [
        {
          provide: ImageStorageService,
          useValue: { readFestivalMap, readCrawlImage },
        },
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => app.close());

  it('serves WebP bytes from the immutable public URL', async () => {
    const bytes = Buffer.from('RIFF0000WEBPtest');
    readFestivalMap.mockResolvedValueOnce(bytes);
    const result = await request(app.getHttpServer() as import('http').Server)
      .get(
        '/api/v1/festivals/fst_01234567/maps/123e4567-e89b-42d3-a456-426614174000.webp',
      )
      .expect(200);
    expect(result.headers['content-type']).toMatch(/^image\/webp/);
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(result.body).toEqual(bytes);
    expect(readFestivalMap).toHaveBeenCalledWith(
      'fst_01234567',
      '123e4567-e89b-42d3-a456-426614174000',
    );
  });

  it('serves only a stored Mint Paper poster', async () => {
    const bytes = Buffer.from('RIFF0000WEBPposter');
    query.mockResolvedValueOnce([{ objectKey: 'crawl/images/poster.webp' }]);
    readCrawlImage.mockResolvedValueOnce(bytes);
    const result = await request(app.getHttpServer() as import('http').Server)
      .get('/api/v1/festivals/images/123e4567-e89b-42d3-a456-426614174000.webp')
      .expect(200);
    expect(result.body).toEqual(bytes);
    expect(result.headers['content-type']).toMatch(/^image\/webp/);
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('does not cache a Commons photo and returns 404 after rights validation removes it', async () => {
    const path =
      '/api/v1/festivals/images/123e4567-e89b-42d3-a456-426614174001.webp';
    const bytes = Buffer.from('RIFF0000WEBPsohyang');
    const readsBefore = readCrawlImage.mock.calls.length;
    query.mockResolvedValueOnce([
      {
        objectKey: 'crawl/images/sohyang.webp',
        seed: 'sohyang-commons-profile',
      },
    ]);
    readCrawlImage.mockResolvedValueOnce(bytes);
    const visible = await request(app.getHttpServer() as import('http').Server)
      .get(path)
      .expect(200);
    expect(visible.headers['cache-control']).toBe('no-store');
    expect(visible.body).toEqual(bytes);

    query.mockResolvedValueOnce([]);
    await request(app.getHttpServer() as import('http').Server)
      .get(path)
      .expect(404);
    expect(readCrawlImage).toHaveBeenCalledTimes(readsBefore + 1);
  });
});
