import type { DataSource } from 'typeorm';
import { backfillOauthTokens } from './backfill-oauth-tokens';
import { OauthTokenCipher } from '../modules/auth/service/oauth-token-cipher';

describe('backfillOauthTokens', () => {
  it('암호화 쓰기가 꺼져 있으면 DB를 열기 전에 거부한다', async () => {
    const transaction = jest.fn();
    const dataSource = { transaction } as unknown as DataSource;
    const cipher = new OauthTokenCipher({
      OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      OAUTH_TOKEN_ENCRYPTION_WRITE: 'false',
    });

    await expect(backfillOauthTokens(dataSource, cipher)).rejects.toThrow(
      '쓰기가 꺼져',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('평문 토큰만 행 잠금 안에서 암호화하고 기존 암호문은 유지한다', async () => {
    const cipher = new OauthTokenCipher({
      OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      OAUTH_TOKEN_ENCRYPTION_WRITE: 'true',
    });
    const userId = '123e4567-e89b-42d3-a456-426614174000';
    const existing = cipher.encode('web-token', userId, 'oauthWebRefreshToken');
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: userId,
          oauthRefreshToken: 'native-token',
          oauthWebRefreshToken: existing,
        },
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
    const dataSource = {
      transaction: jest.fn(
        (work: (manager: { query: typeof query }) => Promise<number>) =>
          work({ query }),
      ),
    } as unknown as DataSource;

    await expect(backfillOauthTokens(dataSource, cipher)).resolves.toBe(1);

    const calls = query.mock.calls as unknown as [string, unknown[]?][];
    const params = calls[1][1] as [string, string, string];
    expect(params[0]).not.toContain('native-token');
    expect(cipher.decode(params[0], userId, 'oauthRefreshToken')).toBe(
      'native-token',
    );
    expect(params[1]).toBe(existing);
    expect(params[2]).toBe(userId);
  });

  it('이전 키 암호문을 현재 키로 다시 암호화한다', async () => {
    const userId = '123e4567-e89b-42d3-a456-426614174000';
    const oldKey = Buffer.alloc(32, 3).toString('base64');
    const newKey = Buffer.alloc(32, 4).toString('base64');
    const oldCipher = new OauthTokenCipher({
      OAUTH_TOKEN_ENCRYPTION_KEY: oldKey,
      OAUTH_TOKEN_ENCRYPTION_WRITE: 'true',
    });
    const cipher = new OauthTokenCipher({
      OAUTH_TOKEN_ENCRYPTION_KEY: newKey,
      OAUTH_TOKEN_ENCRYPTION_PREVIOUS_KEY: oldKey,
      OAUTH_TOKEN_ENCRYPTION_WRITE: 'true',
    });
    const oldValue = oldCipher.encode('old-token', userId, 'oauthRefreshToken');
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: userId, oauthRefreshToken: oldValue, oauthWebRefreshToken: null },
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
    const dataSource = {
      transaction: jest.fn(
        (work: (manager: { query: typeof query }) => Promise<number>) =>
          work({ query }),
      ),
    } as unknown as DataSource;

    await expect(backfillOauthTokens(dataSource, cipher)).resolves.toBe(1);

    const calls = query.mock.calls as unknown as [string, unknown[]?][];
    const params = calls[1][1] as [string, string | null, string];
    expect(params[0]).toMatch(new RegExp(`^${cipher.currentPrefix()}`));
    expect(params[0]).not.toBe(oldValue);
    expect(cipher.decode(params[0], userId, 'oauthRefreshToken')).toBe(
      'old-token',
    );
    expect(params[1]).toBeNull();
  });
});
