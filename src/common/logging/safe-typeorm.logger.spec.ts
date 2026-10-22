import { Logger } from '@nestjs/common';
import type { Logger as TypeOrmLogger } from 'typeorm';
import { SafeTypeOrmLogger } from './safe-typeorm.logger';

describe('SafeTypeOrmLogger', () => {
  it('SQL, 매개변수, 드라이버 메시지 및 마이그레이션 메시지를 기록하지 않는다', () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      const logger: TypeOrmLogger = new SafeTypeOrmLogger();
      const secret = 'oauth-refresh-token-raw';
      const query = `INSERT INTO users VALUES ('${secret}')`;
      const error = Object.assign(new Error(`rejected ${secret}`), {
        code: '23505',
      });

      logger.logQuery(query, [secret]);
      logger.logQueryError(error, query, [secret]);
      logger.logQuerySlow(1200, query, [secret]);
      logger.logSchemaBuild(query);
      logger.logMigration(query);
      logger.log('warn', query);

      const output = JSON.stringify([
        ...errorLog.mock.calls,
        ...warnLog.mock.calls,
      ]);
      expect(output).not.toContain(secret);
      expect(output).not.toContain('INSERT INTO');
      expect(output).toContain('SQLSTATE 23505');
    } finally {
      errorLog.mockRestore();
      warnLog.mockRestore();
    }
  });
});
