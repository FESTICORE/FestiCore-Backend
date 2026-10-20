import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { resolveDbConnection } from './db-ssl';

export const typeOrmConfig = (config: ConfigService): TypeOrmModuleOptions => {
  const isProd = config.get<string>('NODE_ENV') === 'production';
  // Railway는 내부 네트워크로는 DATABASE_URL을, 퍼블릭 액세스를 켜면
  // DATABASE_PUBLIC_URL을 주입한다. 내부 URL이 이그레스 과금이 없어 우선한다.
  const { url, ssl } = resolveDbConnection({
    NODE_ENV: config.get<string>('NODE_ENV'),
    DATABASE_URL: config.get<string>('DATABASE_URL'),
    DATABASE_PUBLIC_URL: config.get<string>('DATABASE_PUBLIC_URL'),
    DB_SSL_CA: config.get<string>('DB_SSL_CA'),
    DB_SSL_INSECURE: config.get<string>('DB_SSL_INSECURE'),
  });

  // 커넥션 풀: Railway Postgres 연결 한도를 고려해 보수적으로 잡는다.
  const poolMax = config.get<number>('DB_POOL_MAX', isProd ? 10 : 5);

  // 로컬(dev)은 synchronize 로 엔티티 변경을 즉시 반영해 개발 편의를 유지한다.
  // 배포(prod)는 synchronize 를 끄고 마이그레이션으로 스키마를 관리한다.
  // (긴급 시에는 DB_SYNCHRONIZE=true 로 잠깐 켤 수 있게 토글을 남겨 둔다.)
  const synchronize =
    config.get<string>('DB_SYNCHRONIZE') === 'true' || !isProd;

  // synchronize 를 쓰지 않는 환경(=prod)에서는 부팅 시 마이그레이션을 실행한다.
  const migrationsRun = !synchronize;

  const base = {
    type: 'postgres' as const,
    autoLoadEntities: true,
    synchronize,
    migrationsRun,
    // 컴파일 전(src, ts-node)과 후(dist, node) 모두에서 마이그레이션을 로드한다.
    migrations: [__dirname + '/../database/migrations/*.{js,ts}'],
    // 쿼리 로깅은 매개변수(토큰 원문 등)까지 찍히므로 끄고 오류·경고·마이그레이션만 남긴다.
    logging: ['error', 'warn', 'migration'] as (
      'error' | 'warn' | 'migration'
    )[],
    poolSize: poolMax,
    extra: {
      max: poolMax,
      // 유휴 커넥션 정리(ms)
      idleTimeoutMillis: config.get<number>('DB_POOL_IDLE_TIMEOUT', 30000),
      // 커넥션 확보 대기 한도(ms) — 초과 시 즉시 에러로 빠르게 실패
      connectionTimeoutMillis: config.get<number>(
        'DB_POOL_CONN_TIMEOUT',
        10000,
      ),
    },
  };

  if (url) {
    return { ...base, url, ssl };
  }

  return {
    ...base,
    host: config.get<string>('DB_HOST', 'localhost'),
    port: config.get<number>('DB_PORT', 5432),
    username: config.get<string>('DB_USERNAME', 'postgres'),
    password: config.get<string>('DB_PASSWORD', 'postgres'),
    database: config.get<string>('DB_NAME', 'festicore'),
  };
};
