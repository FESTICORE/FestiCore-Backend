import type { DataSource } from 'typeorm';
import { AppDataSource } from './data-source';
import { OauthTokenCipher } from '../modules/auth/service/oauth-token-cipher';

type TokenRow = {
  id: string;
  oauthRefreshToken: string | null;
  oauthWebRefreshToken: string | null;
};

/** 모든 인스턴스가 암호문을 읽고 암호화해서 쓰는 상태에서 수동 실행한다. */
export async function backfillOauthTokens(
  dataSource: DataSource,
  cipher: OauthTokenCipher,
): Promise<number> {
  cipher.requireEncryptedWrites();
  let changed = 0;
  const currentPattern = `${cipher.currentPrefix()}%`;
  for (;;) {
    const count = await dataSource.transaction(async (manager) => {
      const rows = await manager.query<TokenRow[]>(
        `SELECT "id", "oauthRefreshToken", "oauthWebRefreshToken"
         FROM "users"
         WHERE ("oauthRefreshToken" IS NOT NULL AND "oauthRefreshToken" NOT LIKE $1)
            OR ("oauthWebRefreshToken" IS NOT NULL AND "oauthWebRefreshToken" NOT LIKE $1)
         ORDER BY "id" LIMIT 100 FOR UPDATE SKIP LOCKED`,
        [currentPattern],
      );
      for (const row of rows) {
        await manager.query(
          `UPDATE "users" SET "oauthRefreshToken" = $1, "oauthWebRefreshToken" = $2
           WHERE "id" = $3`,
          [
            cipher.needsReencrypt(row.oauthRefreshToken)
              ? cipher.encode(
                  cipher.decode(
                    row.oauthRefreshToken,
                    row.id,
                    'oauthRefreshToken',
                  )!,
                  row.id,
                  'oauthRefreshToken',
                )
              : row.oauthRefreshToken,
            cipher.needsReencrypt(row.oauthWebRefreshToken)
              ? cipher.encode(
                  cipher.decode(
                    row.oauthWebRefreshToken,
                    row.id,
                    'oauthWebRefreshToken',
                  )!,
                  row.id,
                  'oauthWebRefreshToken',
                )
              : row.oauthWebRefreshToken,
            row.id,
          ],
        );
      }
      return rows.length;
    });
    changed += count;
    if (count < 100) return changed;
  }
}

if (require.main === module) {
  void (async () => {
    let phase = '설정';
    try {
      const cipher = new OauthTokenCipher(process.env);
      cipher.requireEncryptedWrites();
      phase = '연결';
      await AppDataSource.initialize();
      phase = '재암호화';
      const changed = await backfillOauthTokens(AppDataSource, cipher);
      phase = '잔여 확인';
      const [{ remaining }] = await AppDataSource.query<
        { remaining: number }[]
      >(
        `SELECT count(*)::int AS remaining FROM "users"
         WHERE ("oauthRefreshToken" IS NOT NULL AND "oauthRefreshToken" NOT LIKE $1)
            OR ("oauthWebRefreshToken" IS NOT NULL AND "oauthWebRefreshToken" NOT LIKE $1)`,
        [`${cipher.currentPrefix()}%`],
      );
      if (remaining !== 0)
        throw new Error('이전 키 또는 평문 토큰 행이 남아 있습니다.');
      console.info(`OAuth 토큰 재암호화 완료: ${changed}행`);
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
      console.error(`OAuth 토큰 ${phase} 실패${safeCode}`);
      process.exitCode = 1;
    } finally {
      if (AppDataSource.isInitialized) {
        try {
          await AppDataSource.destroy();
        } catch {
          console.error('OAuth 토큰 재암호화 연결 종료에 실패했습니다.');
          process.exitCode = 1;
        }
      }
    }
  })();
}
