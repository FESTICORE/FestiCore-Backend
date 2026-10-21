import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import sharp from 'sharp';
import { ImageStorageService } from '../../storage/image-storage.service';
import { AdminFestivalMapController } from './admin-festival-map.controller';
import { AdminFestivalService } from './admin-festival.service';

describe('admin festival map upload', () => {
  const imageId = '123e4567-e89b-42d3-a456-426614174000';
  const key = `festivals/fst_01234567/maps/${imageId}.webp`;
  const festivals = { getDraft: jest.fn(), patch: jest.fn() };
  const storage = { saveFestivalMap: jest.fn() };
  const config = {
    get: (name: string) =>
      name === 'PUBLIC_URL'
        ? 'https://festicore-dev.up.railway.app'
        : undefined,
  };
  const controller = new AdminFestivalMapController(
    festivals as unknown as AdminFestivalService,
    storage as unknown as ImageStorageService,
    config as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    festivals.getDraft.mockResolvedValue({ id: 'fst_01234567' });
    storage.saveFestivalMap.mockResolvedValue(key);
  });

  it('returns a stable HTTPS URL and aspect without editing the draft', async () => {
    const buffer = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#2288aa' },
    })
      .png()
      .toBuffer();
    await expect(
      controller.upload('fst_01234567', { buffer, mimetype: 'image/png' }),
    ).resolves.toEqual({
      mapImageUrl: `https://festicore-dev.up.railway.app/api/v1/${key}`,
      mapAspect: 1.5,
    });
    expect(storage.saveFestivalMap).toHaveBeenCalledWith(
      'fst_01234567',
      expect.any(Buffer),
    );
    expect(festivals.patch).not.toHaveBeenCalled();
  });

  it('rejects missing file or festival before writing to storage', async () => {
    await expect(controller.upload('fst_01234567')).rejects.toMatchObject({
      status: 400,
    });
    festivals.getDraft.mockRejectedValueOnce(new Error('missing'));
    await expect(
      controller.upload('fst_01234567', {
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
      }),
    ).rejects.toThrow('missing');
    expect(storage.saveFestivalMap).not.toHaveBeenCalled();
  });

  it('rejects extra multipart fields before processing the image', async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminFestivalMapController],
      providers: [
        { provide: AdminFestivalService, useValue: festivals },
        { provide: ImageStorageService, useValue: storage },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    const app: INestApplication = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    try {
      const image = await sharp({
        create: { width: 300, height: 200, channels: 3, background: '#227799' },
      })
        .png()
        .toBuffer();
      await request(app.getHttpServer() as Server)
        .post('/api/v1/admin/festivals/fst_01234567/draft/map')
        .field('extra', 'unexpected')
        .attach('map', image, { filename: 'map.png', contentType: 'image/png' })
        .expect(400);
      expect(storage.saveFestivalMap).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
