import {
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
import type WebSocket from 'ws';
import { AdminFestival } from '../admin/festival/festival.entity';

const POLL_MS = 3_000;
const HEARTBEAT_MS = 30_000;

type Connection = { ip: string; alive: boolean };

function connectionLimit(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const value = Number(config.get<string>(key));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

@Injectable()
@WebSocketGateway({ path: '/api/v1/festivals/updates', maxPayload: 256 })
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

  constructor(
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    private readonly config: ConfigService,
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
    this.clients.set(client, { ip, alive: true });
    client.on('close', () => this.clients.delete(client));
    client.on('error', () => this.clients.delete(client));
    client.on('pong', () => {
      const connection = this.clients.get(client);
      if (connection) connection.alive = true;
    });
    client.on('message', () => client.close(1008, 'Read-only connection'));
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
          if (client.readyState === 1) client.send(message);
        }
      }
    } catch {
      this.logger.error('공개 팩 변경 확인 실패');
    } finally {
      this.polling = false;
    }
  }
}
