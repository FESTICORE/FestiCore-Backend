/**
 * Postgres 연결 URL과 SSL 옵션을 정한다. 런타임(typeorm.config)과 CLI(data-source)가 공유한다.
 *
 * - 내부 DATABASE_URL(Railway 사설망)이 우선. prod 에서만 SSL.
 * - 퍼블릭 DATABASE_PUBLIC_URL 폴백은 서버 인증 없이 자격증명을 보내지 않도록 fail-closed:
 *   DB_SSL_CA 가 있으면 CA 검증, DB_SSL_INSECURE=true 를 명시하면 암호화만, 둘 다 없으면 에러.
 */
export type DbSsl = false | { rejectUnauthorized: boolean; ca?: string };

export interface DbConnection {
  url?: string;
  ssl: DbSsl;
}

export function resolveDbConnection(env: {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DATABASE_PUBLIC_URL?: string;
  DB_SSL_CA?: string;
  DB_SSL_INSECURE?: string;
}): DbConnection {
  const isProd = env.NODE_ENV === 'production';
  const ca = env.DB_SSL_CA?.replace(/\\n/g, '\n');

  if (env.DATABASE_URL) {
    if (ca)
      return { url: env.DATABASE_URL, ssl: { rejectUnauthorized: true, ca } };
    return {
      url: env.DATABASE_URL,
      ssl: isProd ? { rejectUnauthorized: false } : false,
    };
  }

  if (env.DATABASE_PUBLIC_URL) {
    if (ca) {
      return {
        url: env.DATABASE_PUBLIC_URL,
        ssl: { rejectUnauthorized: true, ca },
      };
    }
    if (env.DB_SSL_INSECURE === 'true') {
      return {
        url: env.DATABASE_PUBLIC_URL,
        ssl: { rejectUnauthorized: false },
      };
    }
    throw new Error(
      'DATABASE_PUBLIC_URL 연결에는 DB_SSL_CA(인증서 검증) 또는 DB_SSL_INSECURE=true(명시적 옵트인)가 필요합니다.',
    );
  }

  // 개별 DB_* 변수(로컬)
  return { ssl: false };
}
