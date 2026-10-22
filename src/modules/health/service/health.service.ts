import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService, RedisStatus } from '../../redis/service/cache.service';

export interface HealthStatus {
  status: 'ok';
  uptime: number;
  timestamp: string;
  db: 'up';
  redis: RedisStatus;
}

/**
 * 서버/DB 상태 확인. DB 프로브(SELECT 1)가 실패하면 503 을 던져
 * Railway 헬스체크가 DB 없는 인스턴스를 정상으로 보지 않게 한다.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: CacheService,
  ) {}

  async check(): Promise<HealthStatus> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException(
        '데이터베이스에 연결할 수 없습니다.',
      );
    }
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      db: 'up',
      redis: await this.cache.status().catch(() => 'down' as const),
    };
  }
}
