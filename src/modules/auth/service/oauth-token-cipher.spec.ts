import { randomBytes } from 'node:crypto';
import { OauthTokenCipher } from './oauth-token-cipher';

describe('OauthTokenCipher', () => {
  const current = randomBytes(32).toString('base64');
  const previous = randomBytes(32).toString('base64');
  const userId = '123e4567-e89b-42d3-a456-426614174000';

  it('암호화 쓰기가 꺼져 있으면 기존 평문을 읽고 쓴다', () => {
    const cipher = new OauthTokenCipher({});
    expect(cipher.encode('private-token', userId, 'oauthRefreshToken')).toBe(
      'private-token',
    );
    expect(cipher.decode('private-token', userId, 'oauthRefreshToken')).toBe(
      'private-token',
    );
  });

  it('AES-GCM으로 암호화하고 사용자와 컬럼을 인증 데이터에 묶는다', () => {
    const cipher = new OauthTokenCipher({
      OAUTH_TOKEN_ENCRYPTION_KEY: current,
      OAUTH_TOKEN_ENCRYPTION_WRITE: 'true',
    });
    const encoded = cipher.encode('private-token', userId, 'oauthRefreshToken');
    expect(encoded).toMatch(/^enc:v1:/);
    expect(encoded).not.toContain('private-token');
    expect(cipher.decode(encoded, userId, 'oauthRefreshToken')).toBe(
      'private-token',
    );
    expect(() =>
      cipher.decode(encoded, userId, 'oauthWebRefreshToken'),
    ).toThrow();
    expect(() =>
      cipher.decode(encoded, 'another-user', 'oauthRefreshToken'),
    ).toThrow();
  });

  it('이전 키로 저장된 암호문을 키 교체 중에도 읽는다', () => {
    const oldCipher = new OauthTokenCipher({
      OAUTH_TOKEN_ENCRYPTION_KEY: previous,
      OAUTH_TOKEN_ENCRYPTION_WRITE: 'true',
    });
    const newCipher = new OauthTokenCipher({
      OAUTH_TOKEN_ENCRYPTION_KEY: current,
      OAUTH_TOKEN_ENCRYPTION_PREVIOUS_KEY: previous,
      OAUTH_TOKEN_ENCRYPTION_WRITE: 'false',
    });
    const encoded = oldCipher.encode(
      'private-token',
      userId,
      'oauthRefreshToken',
    );
    expect(newCipher.decode(encoded, userId, 'oauthRefreshToken')).toBe(
      'private-token',
    );
  });

  it('암호화 쓰기에 키가 없으면 시작 단계에서 실패한다', () => {
    expect(
      () => new OauthTokenCipher({ OAUTH_TOKEN_ENCRYPTION_WRITE: 'true' }),
    ).toThrow('현재 키');
  });

  it('암호화 키가 있는데 쓰기 모드가 없거나 잘못되면 시작 단계에서 실패한다', () => {
    expect(
      () => new OauthTokenCipher({ OAUTH_TOKEN_ENCRYPTION_KEY: current }),
    ).toThrow('쓰기 설정');
    expect(
      () =>
        new OauthTokenCipher({
          OAUTH_TOKEN_ENCRYPTION_KEY: current,
          OAUTH_TOKEN_ENCRYPTION_WRITE: 'tru',
        }),
    ).toThrow('쓰기 설정');
  });
});
