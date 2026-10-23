import { Logger } from '@nestjs/common';
import type { Logger as TypeOrmLogger } from 'typeorm';

/** TypeORM CLI가 logging 옵션을 덮어써도 SQL·매개변수·오류 메시지는 기록하지 않는다. */
export class SafeTypeOrmLogger implements TypeOrmLogger {
  private readonly logger = new Logger('TypeORM');

  logQuery(): void {}

  logQueryError(error: string | Error): void {
    const code =
      error instanceof Error && 'code' in error
        ? (error as Error & { code?: unknown }).code
        : undefined;
    const sqlState =
      typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code)
        ? ` (SQLSTATE ${code})`
        : '';
    this.logger.error(`DB 쿼리 실패${sqlState}`);
  }

  logQuerySlow(time: number): void {
    this.logger.warn(`느린 DB 쿼리 (${Math.round(time)}ms)`);
  }

  logSchemaBuild(): void {}

  logMigration(): void {}

  log(level: 'log' | 'info' | 'warn'): void {
    if (level === 'warn') this.logger.warn('DB 경고');
  }
}
