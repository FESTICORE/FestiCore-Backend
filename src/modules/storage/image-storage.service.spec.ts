import { ConfigService } from '@nestjs/config';
import { Buffer } from 'buffer';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';
import { ImageStorageService, prepareFlagPhoto } from './image-storage.service';

describe('flag image storage', () => {
  it('validates JPEG bytes and produces square WebP variants', async () => {
    const source = await sharp({
      create: {
        width: 320,
        height: 480,
        channels: 3,
        background: '#ff4400',
      },
    })
      .jpeg()
      .toBuffer();
    const result = await prepareFlagPhoto(source, 'image/jpeg');
    expect((await sharp(result.photo).metadata()).format).toBe('webp');
    expect((await sharp(result.photo).metadata()).width).toBe(512);
    expect((await sharp(result.photo).metadata()).height).toBe(512);
    expect((await sharp(result.thumbnail).metadata()).width).toBe(128);
    expect((await sharp(result.thumbnail).metadata()).height).toBe(128);
  });

  it('rejects forged content types and undersized images', async () => {
    const png = await sharp({
      create: {
        width: 320,
        height: 320,
        channels: 3,
        background: '#0044ff',
      },
    })
      .png()
      .toBuffer();
    await expect(prepareFlagPhoto(png, 'image/jpeg')).rejects.toMatchObject({
      status: 415,
    });
    const small = await sharp(png).resize(255, 255).png().toBuffer();
    await expect(prepareFlagPhoto(small, 'image/png')).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      prepareFlagPhoto(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png'),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('rejects a genuine HEIC with an actionable 415 instead of claiming support', async () => {
    const heic = readFileSync(join(__dirname, 'fixtures/valid-320.heic'));
    expect(heic.toString('ascii', 8, 12)).toBe('heic');
    await expect(prepareFlagPhoto(heic, 'image/heic')).rejects.toMatchObject({
      status: 415,
      response: {
        message:
          'HEIC/HEIF 변환은 현재 서버에서 지원되지 않습니다. JPEG 또는 PNG로 변환해 업로드해 주세요.',
      },
    });
  });

  it('rejects keys from another flag before contacting storage', async () => {
    const service = new ImageStorageService({} as ConfigService);
    await expect(
      service.readFlagPhoto('flg_a', 'flags/flg_b/random/photo.webp'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects traversal, forged WebP, and oversized crawl objects', async () => {
    const storage = new ImageStorageService({} as ConfigService);
    const digest = createHash('sha256').update('crawl image').digest('hex');
    const key = `crawl/${digest}.webp`;
    await expect(
      storage.readCrawlImage('../flags/secret.webp'),
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      storage.readCrawlImage(`crawl/${digest.toUpperCase()}.webp`),
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      storage.saveCrawlImage(key, Buffer.from('not-webp'), 'image/webp'),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      storage.saveCrawlImage(
        key,
        Buffer.from('RIFF0000WEBPnot-an-image'),
        'image/webp',
      ),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      storage.saveCrawlImage(
        key,
        Buffer.alloc(2 * 1024 * 1024 + 1),
        'image/webp',
      ),
    ).rejects.toMatchObject({ status: 413 });
    const valid = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#00ff00' },
    })
      .webp()
      .toBuffer();
    await expect(
      storage.saveCrawlImage(key, valid, 'image/webp'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('stores and reads bounded WebP crawl objects through the private bucket', async () => {
    const values: Record<string, string> = {
      RAILWAY_BUCKET_REGION: 'auto',
      RAILWAY_BUCKET_ENDPOINT: 'https://storage.example.test',
      RAILWAY_BUCKET_ACCESS_KEY_ID: 'test-key',
      RAILWAY_BUCKET_SECRET_ACCESS_KEY: 'test-secret',
      RAILWAY_BUCKET_NAME: 'private-images',
    };
    const config = { get: (key: string) => values[key] } as ConfigService;
    const storage = new ImageStorageService(config);
    const bytes = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#00ff00' },
    })
      .webp()
      .toBuffer();
    const digest = createHash('sha256').update(bytes).digest('hex');
    const key = `crawl/${digest}.webp`;
    const send = jest.spyOn(S3Client.prototype, 'send');
    try {
      send.mockResolvedValueOnce({} as never);
      await storage.saveCrawlImage(key, bytes, 'image/webp');
      expect(send).toHaveBeenCalledTimes(1);
      send.mockResolvedValueOnce({
        Body: Readable.from([bytes]),
        ContentLength: bytes.length,
      } as never);
      await expect(storage.readCrawlImage(key)).resolves.toEqual(bytes);
    } finally {
      send.mockRestore();
    }
  });
});
