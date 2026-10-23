import { AppDataSource } from './data-source';

/** TypeORM CLI는 마이그레이션 실패 시 SQL 매개변수를 예외 객체째 출력한다. */
export async function runSafeMigration(
  action: 'run' | 'revert',
  dataSource = AppDataSource,
): Promise<void> {
  let phase: '연결' | '실행' | '되돌리기' = '연결';
  try {
    await dataSource.initialize();
    if (action === 'run') {
      phase = '실행';
      await dataSource.runMigrations();
    } else {
      phase = '되돌리기';
      await dataSource.undoLastMigration();
    }
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    const safeCode =
      typeof code === 'string' &&
      (/^[A-Z0-9]{5}$/.test(code) ||
        ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(code))
        ? ` (${code})`
        : '';
    console.error(`DB 마이그레이션 ${phase} 실패${safeCode}`);
    process.exitCode = 1;
  } finally {
    if (dataSource.isInitialized) {
      try {
        await dataSource.destroy();
      } catch {
        console.error('DB 마이그레이션 연결 종료에 실패했습니다.');
        process.exitCode = 1;
      }
    }
  }
}

if (require.main === module) {
  const action = process.argv[2];
  if (action !== 'run' && action !== 'revert') {
    console.error('run 또는 revert를 지정하세요.');
    process.exitCode = 1;
  } else {
    void runSafeMigration(action);
  }
}
