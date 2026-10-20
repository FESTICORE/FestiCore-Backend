import { resolveDbConnection } from './db-ssl';

describe('resolveDbConnection', () => {
  it('내부 DATABASE_URL 이 우선, prod 면 SSL', () => {
    expect(
      resolveDbConnection({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://internal',
        DATABASE_PUBLIC_URL: 'postgres://public',
      }),
    ).toEqual({
      url: 'postgres://internal',
      ssl: { rejectUnauthorized: false },
    });
  });

  it('퍼블릭 폴백 + DB_SSL_CA → 인증서 검증', () => {
    expect(
      resolveDbConnection({
        DATABASE_PUBLIC_URL: 'postgres://public',
        DB_SSL_CA: 'line1\\nline2',
      }),
    ).toEqual({
      url: 'postgres://public',
      ssl: { rejectUnauthorized: true, ca: 'line1\nline2' },
    });
  });

  it('퍼블릭 폴백 + DB_SSL_INSECURE=true → 명시적 옵트인', () => {
    expect(
      resolveDbConnection({
        DATABASE_PUBLIC_URL: 'postgres://public',
        DB_SSL_INSECURE: 'true',
      }).ssl,
    ).toEqual({ rejectUnauthorized: false });
  });

  it('퍼블릭 폴백만 있고 검증 설정이 없으면 에러(fail-closed)', () => {
    expect(() =>
      resolveDbConnection({ DATABASE_PUBLIC_URL: 'postgres://public' }),
    ).toThrow('DB_SSL_CA');
  });

  it('URL 없으면 개별 DB_* (SSL 없음)', () => {
    expect(resolveDbConnection({})).toEqual({ ssl: false });
  });
});
