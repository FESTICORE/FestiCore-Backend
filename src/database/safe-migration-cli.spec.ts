import type { DataSource } from 'typeorm';
import { runSafeMigration } from './safe-migration-cli';

describe('runSafeMigration', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    jest.restoreAllMocks();
  });

  it('마이그레이션 실패 시 매개변수와 SQL을 숨기고 실패 종료 코드를 설정한다', async () => {
    const secret = 'oauth-refresh-token-raw';
    const output = jest.spyOn(console, 'error').mockImplementation();
    const destroy = jest.fn().mockResolvedValue(undefined);
    const dataSource = {
      initialize: jest.fn().mockResolvedValue(undefined),
      runMigrations: jest.fn().mockRejectedValue(
        Object.assign(new Error(`INSERT INTO users VALUES ('${secret}')`), {
          parameters: [secret],
        }),
      ),
      isInitialized: true,
      destroy,
    } as unknown as DataSource;

    await runSafeMigration('run', dataSource);

    expect(process.exitCode).toBe(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(output.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(output.mock.calls)).not.toContain('INSERT INTO');
    expect(JSON.stringify(output.mock.calls)).toContain('실행 실패');
  });

  it('연결 실패 시 허용된 오류 코드만 기록한다', async () => {
    const output = jest.spyOn(console, 'error').mockImplementation();
    const dataSource = {
      initialize: jest.fn().mockRejectedValue(
        Object.assign(new Error('password=oauth-refresh-token-raw'), {
          code: 'ECONNREFUSED',
        }),
      ),
      isInitialized: false,
    } as unknown as DataSource;

    await runSafeMigration('run', dataSource);

    expect(JSON.stringify(output.mock.calls)).toContain(
      '연결 실패 (ECONNREFUSED)',
    );
    expect(JSON.stringify(output.mock.calls)).not.toContain(
      'oauth-refresh-token-raw',
    );
  });
});
