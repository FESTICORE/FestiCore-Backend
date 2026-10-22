import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';

export type RedisStatus = 'up' | 'down' | 'disabled';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis | null;
  private connectionDown = false;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    this.client = url
      ? new Redis(url, {
          enableOfflineQueue: false,
          family: 0,
          commandTimeout: 500,
          connectTimeout: 500,
          maxRetriesPerRequest: 0,
          retryStrategy: (attempt) => Math.min(attempt * 100, 1000),
        })
      : null;
    this.client?.on('error', (error: Error) => this.markDown(error));
    this.client?.on('ready', () => this.markUp());
  }

  private markDown(error: unknown): void {
    if (this.connectionDown) return;
    this.connectionDown = true;
    this.logger.warn(`Redis connection down: ${String(error)}`);
  }

  private markUp(): void {
    if (!this.connectionDown) return;
    this.connectionDown = false;
    this.logger.log('Redis connection recovered');
  }

  private async command<T>(
    operation: () => Promise<T>,
  ): Promise<T | undefined> {
    if (!this.client) return undefined;
    try {
      const result = await operation();
      this.markUp();
      return result;
    } catch (error) {
      this.markDown(error);
      return undefined;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.command(() => this.client!.get(key));
    if (value == null) return null;
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.warn(`Redis JSON decode failed: ${String(error)}`);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    await this.command(() =>
      this.client!.set(key, JSON.stringify(value), 'EX', ttlSec),
    );
  }

  async del(key: string): Promise<void> {
    await this.command(() => this.client!.del(key));
  }

  async status(): Promise<RedisStatus> {
    if (!this.client) return 'disabled';
    return (await this.command(() => this.client!.ping())) === 'PONG'
      ? 'up'
      : 'down';
  }

  async packGeneration(festivalId: string): Promise<number | null> {
    if (!this.client) return null;
    const key = `pack:${festivalId}:gen`;
    const value = await this.command(() => this.client!.get(key));
    if (value === undefined) return null;
    let current = value;
    if (current === null) {
      // NX ensures concurrent readers share one seed; a stale g0 is never reused.
      const seed = randomBytes(6).readUIntBE(0, 6) + 1;
      if (
        (await this.command(() =>
          this.client!.set(key, String(seed), 'NX'),
        )) === undefined
      )
        return null;
      const seededValue = await this.command(() => this.client!.get(key));
      if (seededValue == null) return null;
      current = seededValue;
    }
    const generation = Number(current);
    return Number.isSafeInteger(generation) && generation >= 0
      ? generation
      : null;
  }

  getPack<T>(festivalId: string, generation: number): Promise<T | null> {
    return this.getJson<T>(`pack:${festivalId}:g${generation}`);
  }

  async setPack(
    festivalId: string,
    generation: number,
    document: unknown,
  ): Promise<void> {
    await this.setJson(`pack:${festivalId}:g${generation}`, document, 3600);
  }

  async invalidatePack(festivalId: string): Promise<void> {
    await this.command(() => this.client!.incr(`pack:${festivalId}:gen`));
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn(`Redis quit failed: ${String(error)}`);
      this.client.disconnect();
    }
  }
}
