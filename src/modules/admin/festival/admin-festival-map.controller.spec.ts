import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Logger, type INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import { ImageStorageService } from '../../storage/image-storage.service';
import { AdminAuditService } from '../audit/admin-audit.service';
import { AdminFestivalMapController } from './admin-festival-map.controller';
import { AdminFestivalService } from './admin-festival.service';

describe('admin festival map upload', () => {
  const imageId = '123e4567-e89b-42d3-a456-426614174000';
  const key = `festivals/fst_01234567/maps/${imageId}.webp`;
  const festivals = { getDraft: jest.fn(), patch: jest.fn() };
  const storage = { saveFestivalMap: jest.fn(), delete: jest.fn() };
  const audit = { record: jest.fn() };
  const manager = {};
  const db = {
    transaction: jest.fn((work: (manager: object) => Promise<unknown>) =>
      work(manager),
    ),
  };
  const adminRequest = { admin: { id: 'admin-1' } } as never;
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
    db as unknown as DataSource,
    audit as unknown as AdminAuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    festivals.getDraft.mockResolvedValue({ id: 'fst_01234567' });
    storage.saveFestivalMap.mockResolvedValue(key);
    storage.delete.mockResolvedValue(undefined);
    audit.record.mockResolvedValue(undefined);
  });

  it('returns a stable HTTPS URL and aspect without editing the draft', async () => {
    const buffer = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#2288aa' },
    })
      .png()
      .toBuffer();
    await expect(
      controller.upload(
        'fst_01234567',
        { buffer, mimetype: 'image/png' },
        adminRequest,
      ),
    ).resolves.toEqual({
      mapImageUrl: `https://festicore-dev.up.railway.app/api/v1/${key}`,
      mapAspect: 1.5,
    });
    expect(storage.saveFestivalMap).toHaveBeenCalledWith(
      'fst_01234567',
      expect.any(Buffer),
    );
    expect(festivals.patch).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(manager, {
      actor: 'admin-1',
      action: 'festival.map.uploaded',
      target: 'festival:fst_01234567',
      before: null,
      after: { key, aspect: 1.5 },
    });
  });

  it('deletes an uploaded map if the audit write fails', async () => {
    const buffer = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#2288aa' },
    })
      .png()
      .toBuffer();
    audit.record.mockRejectedValueOnce(new Error('audit failed'));
    await expect(
      controller.upload(
        'fst_01234567',
        { buffer, mimetype: 'image/png' },
        adminRequest,
      ),
    ).rejects.toThrow('audit failed');
    expect(storage.delete).toHaveBeenCalledWith(key);
  });

  it('logs the map key if audit and storage cleanup both fail', async () => {
    const buffer = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#2288aa' },
    })
      .png()
      .toBuffer();
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    audit.record.mockRejectedValueOnce(new Error('audit failed'));
    storage.delete.mockRejectedValueOnce(new Error('delete failed'));
    try {
      await expect(
        controller.upload(
          'fst_01234567',
          { buffer, mimetype: 'image/png' },
          adminRequest,
        ),
      ).rejects.toThrow('audit failed');
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(key),
        expect.stringContaining('delete failed'),
      );
    } finally {
      log.mockRestore();
    }
  });

  it('rejects missing file or festival before writing to storage', async () => {
    await expect(
      controller.upload('fst_01234567', undefined, adminRequest),
    ).rejects.toMatchObject({
      status: 400,
    });
    festivals.getDraft.mockRejectedValueOnce(new Error('missing'));
    await expect(
      controller.upload(
        'fst_01234567',
        {
          buffer: Buffer.from('x'),
          mimetype: 'image/png',
        },
        adminRequest,
      ),
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
        { provide: DataSource, useValue: db },
        { provide: AdminAuditService, useValue: audit },
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
