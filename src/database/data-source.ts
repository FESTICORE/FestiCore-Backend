import 'reflect-metadata';
import { existsSync } from 'fs';
import { DataSource, DataSourceOptions } from 'typeorm';
import { resolveDbConnection } from '../config/db-ssl';

/**
 * TypeORM CLI(마이그레이션 생성/실행) 전용 DataSource.
 *
 * 런타임(Nest 앱)은 `config/typeorm.config.ts` 를 사용하고, 이 파일은 CLI 에서만 쓴다.
 * 런타임과 같은 env 파일 체인과 연결 규칙(resolveDbConnection)을 사용한다.
 */
const isCompiled = __filename.endsWith('.js');
const root = isCompiled ? 'dist' : 'src';

/** 앱(ConfigModule)과 같은 순서로 env 파일을 읽는다. 이미 설정된 변수는 덮지 않는다. */
function loadEnvFiles(): void {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  for (const file of [
    '.env.local',
    `.env.${nodeEnv}.local`,
    `.env.${nodeEnv}`,
    '.env',
  ]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function createDataSourceOptions(
  env: NodeJS.ProcessEnv,
): DataSourceOptions {
  const { url, ssl } = resolveDbConnection(env);

  const base = {
    type: 'postgres' as const,
    entities: [`${root}/**/*.entity.{ts,js}`],
    migrations: [`${root}/database/migrations/*.{ts,js}`],
    synchronize: false,
    logging: ['error', 'warn', 'migration'] as (
      'error' | 'warn' | 'migration'
    )[],
  };

  return url
    ? { ...base, url, ssl }
    : {
        ...base,
        host: env.DB_HOST ?? 'localhost',
        port: Number(env.DB_PORT ?? 5432),
        username: env.DB_USERNAME ?? 'postgres',
        password: env.DB_PASSWORD ?? 'postgres',
        database: env.DB_NAME ?? 'festicore',
      };
}

loadEnvFiles();

export const AppDataSource = new DataSource(
  createDataSourceOptions(process.env),
);
