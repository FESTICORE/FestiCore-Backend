import {
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import sharp from 'sharp';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const CRAWL_IMAGE_KEY = /^crawl\/[0-9a-f]{64}\.webp$/;
const CRAWL_SNAPSHOT_KEY =
  /^crawl\/snapshots\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.txt$/;
const execFileAsync = promisify(execFile);

export interface PreparedFlagPhoto {
  photo: Buffer;
  thumbnail: Buffer;
}

function imageType(bytes: Buffer): 'jpeg' | 'png' | 'heif' | null {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return 'jpeg';
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png';
  if (bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand))
      return 'heif';
  }
  return null;
}

async function decodeHeif(bytes: Buffer): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'festicore-heif-'));
  const source = join(directory, 'source.heic');
  const decoded = join(directory, 'decoded.jpg');
  try {
    await writeFile(source, bytes, { mode: 0o600 });
    await execFileAsync('heif-dec', ['-q', '90', source, decoded], {
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    if ((await stat(decoded)).size > MAX_IMAGE_BYTES * 10)
      throw new PayloadTooLargeException('변환된 사진이 너무 큽니다.');
    return await readFile(decoded);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Decode and re-encode to strip EXIF and prevent client-controlled image payloads. */
export async function prepareFlagPhoto(
  bytes: Buffer,
  declaredType: string,
): Promise<PreparedFlagPhoto> {
  if (bytes.length > MAX_IMAGE_BYTES) throw new PayloadTooLargeException();
  const kind = imageType(bytes);
  const allowed = {
    jpeg: ['image/jpeg'],
    png: ['image/png'],
    heif: ['image/heic', 'image/heif'],
  };
  if (!kind || !allowed[kind].includes(declaredType.toLowerCase()))
    throw new UnsupportedMediaTypeException(
      'JPEG, PNG 또는 HEIC/HEIF 사진만 허용됩니다.',
    );
  try {
    const image = sharp(kind === 'heif' ? await decodeHeif(bytes) : bytes, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
    });
    const metadata = await image.metadata();
    if (
      metadata.width === undefined ||
      metadata.height === undefined ||
      metadata.width < 256 ||
      metadata.height < 256
    )
      throw new BadRequestException('사진은 최소 256×256이어야 합니다.');
    const photo = await image
      .clone()
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();
    const thumbnail = await image
      .clone()
      .rotate()
      .resize(128, 128, { fit: 'cover', position: 'centre' })
      .webp({ quality: 78 })
      .toBuffer();
    if (photo.length > MAX_OUTPUT_BYTES || thumbnail.length > MAX_OUTPUT_BYTES)
      throw new PayloadTooLargeException('변환된 사진이 너무 큽니다.');
    return { photo, thumbnail };
  } catch (error) {
    if (
      error instanceof BadRequestException ||
      error instanceof PayloadTooLargeException
    )
      throw error;
    throw new UnsupportedMediaTypeException('사진을 디코딩할 수 없습니다.');
  }
}

@Injectable()
export class ImageStorageService {
  constructor(private readonly config: ConfigService) {}

  private value(...keys: string[]): string {
    for (const key of keys) {
      const value = this.config.get<string>(key);
      if (value) return value;
    }
    throw new ServiceUnavailableException('이미지 저장소 설정이 없습니다.');
  }

  private client(): S3Client {
    return new S3Client({
      region: this.value('RAILWAY_BUCKET_REGION', 'AWS_DEFAULT_REGION'),
      endpoint: this.value('RAILWAY_BUCKET_ENDPOINT', 'AWS_ENDPOINT_URL'),
      forcePathStyle:
        this.config.get<string>('AWS_S3_URL_STYLE', 'virtual') !== 'virtual',
      credentials: {
        accessKeyId: this.value(
          'RAILWAY_BUCKET_ACCESS_KEY_ID',
          'AWS_ACCESS_KEY_ID',
        ),
        secretAccessKey: this.value(
          'RAILWAY_BUCKET_SECRET_ACCESS_KEY',
          'AWS_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  async saveFlagPhoto(flagId: string, image: PreparedFlagPhoto) {
    const base = `flags/${flagId}/${randomUUID()}`;
    const photoKey = `${base}/photo.webp`;
    const thumbKey = `${base}/thumbnail.webp`;
    const client = this.client();
    const bucket = this.value('RAILWAY_BUCKET_NAME', 'AWS_S3_BUCKET_NAME');
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: photoKey,
          Body: image.photo,
          ContentType: 'image/webp',
          CacheControl: 'private, max-age=86400',
        }),
      );
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: thumbKey,
          Body: image.thumbnail,
          ContentType: 'image/webp',
          CacheControl: 'private, max-age=86400',
        }),
      );
      return { photoKey, thumbKey };
    } catch (error) {
      await Promise.allSettled([this.delete(photoKey), this.delete(thumbKey)]);
      throw error;
    } finally {
      client.destroy();
    }
  }

  async readFlagPhoto(flagId: string, key: string): Promise<Buffer> {
    if (!key.startsWith(`flags/${flagId}/`) || !key.endsWith('.webp'))
      throw new BadRequestException('잘못된 사진 키입니다.');
    return this.read(key);
  }

  async saveCrawlImage(
    key: string,
    bytes: Buffer,
    contentType: 'image/webp',
  ): Promise<void> {
    this.validateCrawlImageKey(key);
    if (!bytes.length)
      throw new BadRequestException('크롤링 이미지가 비어 있습니다.');
    if (bytes.length > MAX_OUTPUT_BYTES) throw new PayloadTooLargeException();
    if (
      contentType !== 'image/webp' ||
      bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP'
    )
      throw new UnsupportedMediaTypeException(
        'WebP 이미지만 저장할 수 있습니다.',
      );
    try {
      const metadata = await sharp(bytes, {
        failOn: 'error',
        limitInputPixels: 40_000_000,
      }).metadata();
      if (metadata.format !== 'webp') throw new Error('not a WebP image');
    } catch {
      throw new UnsupportedMediaTypeException(
        'WebP 이미지를 디코딩할 수 없습니다.',
      );
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (key !== `crawl/${digest}.webp`)
      throw new BadRequestException(
        '크롤링 이미지 키와 내용이 일치하지 않습니다.',
      );
    const client = this.client();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.value('RAILWAY_BUCKET_NAME', 'AWS_S3_BUCKET_NAME'),
          Key: key,
          Body: bytes,
          ContentType: 'image/webp',
          CacheControl: 'private, max-age=86400',
        }),
      );
    } finally {
      client.destroy();
    }
  }

  async readCrawlImage(key: string): Promise<Buffer> {
    this.validateCrawlImageKey(key);
    return this.read(key);
  }

  async saveCrawlSnapshot(key: string, bytes: Buffer): Promise<void> {
    this.validateCrawlSnapshotKey(key);
    if (!bytes.length)
      throw new BadRequestException('크롤링 스냅샷이 비어 있습니다.');
    if (bytes.length > MAX_OUTPUT_BYTES) throw new PayloadTooLargeException();
    const client = this.client();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.value('RAILWAY_BUCKET_NAME', 'AWS_S3_BUCKET_NAME'),
          Key: key,
          Body: bytes,
          ContentType: 'text/plain; charset=utf-8',
          CacheControl: 'private, max-age=86400',
        }),
      );
    } finally {
      client.destroy();
    }
  }

  async readCrawlSnapshot(key: string): Promise<Buffer> {
    this.validateCrawlSnapshotKey(key);
    return this.read(key);
  }

  async deleteCrawlSnapshot(key: string): Promise<void> {
    this.validateCrawlSnapshotKey(key);
    await this.delete(key);
  }

  private validateCrawlSnapshotKey(key: string): void {
    if (!CRAWL_SNAPSHOT_KEY.test(key))
      throw new BadRequestException('잘못된 크롤링 스냅샷 키입니다.');
  }

  private validateCrawlImageKey(key: string): void {
    if (!CRAWL_IMAGE_KEY.test(key))
      throw new BadRequestException('잘못된 크롤링 이미지 키입니다.');
  }

  private async read(key: string): Promise<Buffer> {
    const client = this.client();
    try {
      let object: GetObjectCommandOutput;
      try {
        object = await client.send(
          new GetObjectCommand({
            Bucket: this.value('RAILWAY_BUCKET_NAME', 'AWS_S3_BUCKET_NAME'),
            Key: key,
          }),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          ['NoSuchKey', 'NotFound'].includes(error.name)
        )
          throw new NotFoundException('사진을 찾을 수 없습니다.');
        throw error;
      }
      if (!object.Body || (object.ContentLength ?? 0) > MAX_OUTPUT_BYTES)
        throw new PayloadTooLargeException('저장된 사진을 읽을 수 없습니다.');
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
        length += chunk.length;
        if (length > MAX_OUTPUT_BYTES) throw new PayloadTooLargeException();
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks, length);
    } finally {
      client.destroy();
    }
  }

  async delete(key: string | null): Promise<void> {
    if (!key) return;
    const client = this.client();
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: this.value('RAILWAY_BUCKET_NAME', 'AWS_S3_BUCKET_NAME'),
          Key: key,
        }),
      );
    } finally {
      client.destroy();
    }
  }
}
