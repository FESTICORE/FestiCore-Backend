import { Test } from '@nestjs/testing';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { ImageStorageService } from '../storage/image-storage.service';
import { PublicFestivalMapController } from './public-festival-map.controller';

describe('GET festival map image', () => {
  let app: INestApplication;
  const readFestivalMap = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PublicFestivalMapController],
      providers: [
        { provide: ImageStorageService, useValue: { readFestivalMap } },
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
    expect(result.body).toEqual(bytes);
    expect(readFestivalMap).toHaveBeenCalledWith(
      'fst_01234567',
      '123e4567-e89b-42d3-a456-426614174000',
    );
  });
});
