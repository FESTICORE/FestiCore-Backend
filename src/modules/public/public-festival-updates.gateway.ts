import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { MoreThan, Repository } from 'typeorm';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import type WebSocket from 'ws';
import { AdminFestival } from '../admin/festival/festival.entity';
import { PublicFestivalService } from './public-festival.service';

const POLL_MS = 3_000;
const HEARTBEAT_MS = 30_000;
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_PACK_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 48 * 1024;
const RETRY_AFTER_MS = 1_000;
const MAX_ACTIVE_PACKS = 32;

type Connection = {
  ip: string;
  alive: boolean;
  busy: boolean;
  requests: number[];
};
type PackRequest = {
  event: 'pack.get';
  requestId: string;
  data: { festivalId: string; ifNoneMatch?: string };
};

function packRequest(value: unknown): value is PackRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (
    Object.keys(message).some(
      (key) => !['event', 'requestId', 'data'].includes(key),
    ) ||
    message.event !== 'pack.get' ||
    typeof message.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(message.requestId) ||
    !message.data ||
    typeof message.data !== 'object' ||
    Array.isArray(message.data)
  )
    return false;
  const data = message.data as Record<string, unknown>;
  return (
    Object.keys(data).every((key) =>
      ['festivalId', 'ifNoneMatch'].includes(key),
    ) &&
    typeof data.festivalId === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(data.festivalId) &&
    (data.ifNoneMatch === undefined ||
      (typeof data.ifNoneMatch === 'string' && data.ifNoneMatch.length <= 128))
  );
}

function connectionLimit(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const value = Number(config.get<string>(key));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

@Injectable()
@WebSocketGateway({ path: '/api/v1/festivals/updates', maxPayload: 1024 })
export class PublicFestivalUpdatesGateway
  implements OnGatewayConnection, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PublicFestivalUpdatesGateway.name);
  private readonly clients = new Map<WebSocket, Connection>();
  private readonly seen = new Map<string, number>();
  private seeded = false;
  private timer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private polling = false;
  private activePacks = 0;

  constructor(
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    private readonly config: ConfigService,
    private readonly publicFestivals: PublicFestivalService,
  ) {}

  private clientIp(request: IncomingMessage): string {
    const railwayIp = this.config.get<string>('RAILWAY_ENVIRONMENT')
      ? request.headers['x-real-ip']
      : undefined;
    return typeof railwayIp === 'string' && isIP(railwayIp)
      ? railwayIp
      : (request.socket.remoteAddress ?? 'unknown');
  }

  upgradeDecision(request: IncomingMessage): 403 | 429 | null {
    const origin = request.headers.origin;
    const configured = this.config.get<string>('CORS_ORIGINS');
    const allowed =
      configured
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => new URL(value).origin) ?? [];
    const production = this.config.get<string>('NODE_ENV') === 'production';
    if (
      origin &&
      (production || allowed.length > 0) &&
      !allowed.includes(origin)
    )
      return 403;
    const ip = this.clientIp(request);
    if (
      this.clients.size >=
        connectionLimit(this.config, 'WS_MAX_CLIENTS', 5_000) ||
      [...this.clients.values()].filter((value) => value.ip === ip).length >=
        connectionLimit(this.config, 'WS_MAX_CLIENTS_PER_IP', 500)
    )
      return 429;
    return null;
  }

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const decision = this.upgradeDecision(request);
    if (decision) {
      client.close(decision === 403 ? 1008 : 1013);
      return;
    }
    const ip = this.clientIp(request);
    this.clients.set(client, { ip, alive: true, busy: false, requests: [] });
    client.on('close', () => this.clients.delete(client));
    client.on('error', () => this.clients.delete(client));
    client.on('pong', () => {
      const connection = this.clients.get(client);
      if (connection) connection.alive = true;
    });
    client.on('message', (bytes: Buffer, isBinary: boolean) => {
      if (isBinary || bytes.length > 1024) {
        client.close(isBinary ? 1008 : 1009);
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        client.close(1008);
        return;
      }
      if (!packRequest(value)) {
        client.close(1008);
        return;
      }
      void this.handlePackGet(client, value);
    });
  }

  private async send(client: WebSocket, message: unknown): Promise<boolean> {
    if (client.readyState !== 1) return false;
    const json = JSON.stringify(message);
    const bytes = Buffer.byteLength(json);
    if (
      bytes > MAX_MESSAGE_BYTES ||
      client.bufferedAmount + bytes > MAX_MESSAGE_BYTES
    ) {
      client.close(1013, 'Slow connection');
      return false;
    }
    return new Promise<boolean>((resolve) => {
      try {
        client.send(json, (error?: Error) => {
          if (error) {
            client.terminate();
            resolve(false);
          } else resolve(client.readyState === 1);
        });
      } catch {
        client.terminate();
        resolve(false);
      }
    });
  }

  private async handlePackGet(
    client: WebSocket,
    request: PackRequest,
  ): Promise<void> {
    const connection = this.clients.get(client);
    if (!connection || client.readyState !== 1) return;
    const now = Date.now();
    connection.requests = connection.requests.filter((at) => now - at < 10_000);
    if (
      connection.busy ||
      connection.requests.length >= 10 ||
      this.activePacks >= MAX_ACTIVE_PACKS
    ) {
      await this.send(client, {
        event: 'pack.error',
        requestId: request.requestId,
        data: { code: 'PACK_BUSY', retryAfterMs: RETRY_AFTER_MS },
      });
      return;
    }
    connection.requests.push(now);
    connection.busy = true;
    this.activePacks++;
    const { festivalId } = request.data;
    try {
      const { document: pack, etag } =
        await this.publicFestivals.publishedPack(festivalId);
      const row = await this.festivals.findOne({
        select: { id: true, publishedVersion: true, published: true },
        where: { id: festivalId },
      });
      if (!row?.published || row.publishedVersion < 1) {
        await this.send(client, {
          event: 'pack.error',
          requestId: request.requestId,
          data: { code: 'FESTIVAL_NOT_FOUND' },
        });
        return;
      }
      const packVersion = pack.packVersion;
      if (packVersion !== row.publishedVersion) {
        await this.send(client, {
          event: 'pack.retry',
          requestId: request.requestId,
          data: {
            festivalId,
            packVersion: row.publishedVersion,
            retryAfterMs: RETRY_AFTER_MS,
          },
        });
        return;
      }
      if (request.data.ifNoneMatch === etag) {
        await this.send(client, {
          event: 'pack.not_modified',
          requestId: request.requestId,
          data: { festivalId, packVersion, etag },
        });
        return;
      }
      const packJson = JSON.stringify(pack);
      if (Buffer.byteLength(packJson) > MAX_PACK_BYTES) {
        await this.send(client, {
          event: 'pack.error',
          requestId: request.requestId,
          data: { code: 'PACK_TOO_LARGE' },
        });
        return;
      }
      const snapshot = {
        event: 'pack.snapshot',
        requestId: request.requestId,
        data: { festivalId, packVersion, etag, pack },
      };
      if (Buffer.byteLength(JSON.stringify(snapshot)) <= MAX_MESSAGE_BYTES) {
        await this.send(client, snapshot);
        return;
      }
      const bytes = Buffer.from(packJson, 'utf8');
      const chunkCount = Math.ceil(bytes.length / CHUNK_BYTES);
      const started = await this.send(client, {
        event: 'pack.start',
        requestId: request.requestId,
        data: {
          festivalId,
          packVersion,
          etag,
          totalBytes: bytes.length,
          chunkCount,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      });
      if (!started) return;
      for (let index = 0; index < chunkCount; index++) {
        if (
          !(await this.send(client, {
            event: 'pack.chunk',
            requestId: request.requestId,
            data: {
              index,
              base64: bytes
                .subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)
                .toString('base64'),
            },
          }))
        )
          return;
      }
      await this.send(client, {
        event: 'pack.complete',
        requestId: request.requestId,
      });
    } catch (error) {
      const code =
        error instanceof HttpException && error.getStatus() === 404
          ? 'FESTIVAL_NOT_FOUND'
          : 'PACK_UNAVAILABLE';
      if (code === 'PACK_UNAVAILABLE')
        this.logger.error('공개 팩 WebSocket 조회 실패');
      await this.send(client, {
        event: 'pack.error',
        requestId: request.requestId,
        data: { code },
      });
    } finally {
      connection.busy = false;
      this.activePacks--;
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.seedVersions();
    } catch {
      this.logger.warn(
        '공개 팩 기준 버전을 읽지 못했습니다. 연결 후 다시 시도합니다.',
      );
    }
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.heartbeatTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const client of this.clients.keys())
      client.close(1001, 'Server shutting down');
    this.clients.clear();
  }

  heartbeat(): void {
    for (const [client, connection] of this.clients) {
      if (!connection.alive || client.readyState !== 1) {
        this.clients.delete(client);
        client.terminate();
        continue;
      }
      connection.alive = false;
      client.ping();
    }
  }

  private readVersions(): Promise<AdminFestival[]> {
    return this.festivals.find({
      select: { id: true, publishedVersion: true },
      where: { publishedVersion: MoreThan(0) },
    });
  }

  private async seedVersions(): Promise<void> {
    const rows = await this.readVersions();
    for (const row of rows) this.seen.set(row.id, row.publishedVersion);
    this.seeded = true;
  }

  async poll(): Promise<void> {
    if (this.polling || this.clients.size === 0) return;
    this.polling = true;
    try {
      if (!this.seeded) {
        await this.seedVersions();
        return;
      }
      const rows = await this.readVersions();
      for (const row of rows) {
        if ((this.seen.get(row.id) ?? 0) >= row.publishedVersion) continue;
        this.seen.set(row.id, row.publishedVersion);
        const message = JSON.stringify({
          event: 'pack.updated',
          data: { festivalId: row.id, packVersion: row.publishedVersion },
        });
        for (const client of this.clients.keys()) {
          if (client.readyState === 1)
            void this.send(client, JSON.parse(message) as unknown);
        }
      }
    } catch {
      this.logger.error('공개 팩 변경 확인 실패');
    } finally {
      this.polling = false;
    }
  }
}
