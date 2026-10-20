import { ConfigService } from '@nestjs/config';
import { Buffer } from 'buffer';
import { createHash, randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
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

  it('rejects a genuine HEIC with a forged MIME type', async () => {
    const heic = readFileSync(join(__dirname, 'fixtures/valid-320.heic'));
    expect(heic.toString('ascii', 8, 12)).toBe('heic');
    await expect(prepareFlagPhoto(heic, 'image/jpeg')).rejects.toMatchObject({
      status: 415,
    });
  });

  (existsSync('/usr/bin/heif-dec') ? it : it.skip)(
    'converts a genuine HEIC to square WebP variants',
    async () => {
      const heic = readFileSync(join(__dirname, 'fixtures/valid-320.heic'));
      const result = await prepareFlagPhoto(heic, 'image/heic');
      expect((await sharp(result.photo).metadata()).format).toBe('webp');
      expect((await sharp(result.photo).metadata()).width).toBe(512);
      expect((await sharp(result.thumbnail).metadata()).width).toBe(128);
    },
  );

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

  it('stores, reads, and deletes private bounded text crawl snapshots', async () => {
    const values: Record<string, string> = {
      RAILWAY_BUCKET_REGION: 'auto',
      RAILWAY_BUCKET_ENDPOINT: 'https://storage.example.test',
      RAILWAY_BUCKET_ACCESS_KEY_ID: 'test-key',
      RAILWAY_BUCKET_SECRET_ACCESS_KEY: 'test-secret',
      RAILWAY_BUCKET_NAME: 'private-images',
    };
    const storage = new ImageStorageService({
      get: (key: string) => values[key],
    } as ConfigService);
    const key = `crawl/snapshots/${randomUUID()}.txt`;
    const bytes = Buffer.from('<html>축제</html>');
    const send = jest.spyOn(S3Client.prototype, 'send');
    try {
      await expect(
        storage.saveCrawlSnapshot('../flags/secret.webp', bytes),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        storage.readCrawlSnapshot('crawl/elsewhere.html'),
      ).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        storage.readCrawlSnapshot(key.replace(/\.txt$/, '.html')),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        storage.deleteCrawlSnapshot('../flags/secret.webp'),
      ).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        storage.saveCrawlSnapshot(key, Buffer.alloc(0)),
      ).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        storage.saveCrawlSnapshot(key, Buffer.alloc(2 * 1024 * 1024 + 1)),
      ).rejects.toMatchObject({ status: 413 });
      expect(send).not.toHaveBeenCalled();

      send.mockResolvedValueOnce({} as never);
      await storage.saveCrawlSnapshot(key, bytes);
      expect(send.mock.calls[0][0]).toMatchObject({
        input: {
          Bucket: 'private-images',
          Key: key,
          Body: bytes,
          ContentType: 'text/plain; charset=utf-8',
        },
      });
      const upload = send.mock.calls[0][0] as {
        input: { CacheControl: string };
      };
      expect(upload.input.CacheControl).toContain('private');

      send.mockResolvedValueOnce({
        Body: Readable.from([bytes]),
        ContentLength: bytes.length,
      } as never);
      await expect(storage.readCrawlSnapshot(key)).resolves.toEqual(bytes);

      send.mockResolvedValueOnce({
        Body: Readable.from([Buffer.alloc(2 * 1024 * 1024), Buffer.from('x')]),
      } as never);
      await expect(storage.readCrawlSnapshot(key)).rejects.toMatchObject({
        status: 413,
      });

      send.mockResolvedValueOnce({} as never);
      await storage.deleteCrawlSnapshot(key);
      expect(send.mock.calls[3][0]).toMatchObject({
        input: { Bucket: 'private-images', Key: key },
      });
    } finally {
      send.mockRestore();
    }
  });
});
