import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { AdminFestivalImageController } from './admin-festival-image.controller';
import { AdminFestivalService } from './admin-festival.service';
import { TimetableImageService } from './timetable-image.service';

describe('admin timetable image endpoint', () => {
  const festival = { days: [{ date: '2026-10-24' }], stages: [] };
  const festivals = {
    getDraft: jest.fn().mockResolvedValue(festival),
    patch: jest.fn(),
  };
  const images = {
    preview: jest
      .fn()
      .mockResolvedValue({ draft: [], confidence: 0, unparsed: ['확인 필요'] }),
  };
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminFestivalImageController],
      providers: [
        { provide: AdminFestivalService, useValue: festivals },
        { provide: TimetableImageService, useValue: images },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('returns HTTP 200 preview without saving the draft', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/festivals/fst_01234567/pack/import-image')
      .field('date', '2026-10-24')
      .attach('image', Buffer.from('image bytes'), {
        filename: 'schedule.png',
        contentType: 'image/png',
      })
      .expect(200);
    expect(response.body).toEqual({
      draft: [],
      confidence: 0,
      unparsed: ['확인 필요'],
    });
    expect(images.preview).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/png',
      '2026-10-24',
      festival,
    );
    expect(festivals.patch).not.toHaveBeenCalled();
  });

  it('rejects extra multipart fields and does not run OCR', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/festivals/fst_01234567/pack/import-image')
      .field('date', '2026-10-24')
      .field('unexpected', 'value')
      .attach('image', Buffer.from('image bytes'), {
        filename: 'schedule.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(images.preview).not.toHaveBeenCalled();
  });
});
