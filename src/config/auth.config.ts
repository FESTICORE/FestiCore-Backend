import { registerAs } from '@nestjs/config';

/**
 * JWT secret 검증. 누락되거나 access/refresh 가 같으면 부팅을 실패시킨다.
 * (같은 secret 이면 refresh 토큰이 access 토큰으로 통과할 수 있다)
 * 테스트 환경은 각 스펙이 설정을 직접 주입하므로 건너뛴다.
 */
export function assertJwtSecrets(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'test') return;
  const access = env.JWT_ACCESS_SECRET;
  const refresh = env.JWT_REFRESH_SECRET;
  if (!access || !refresh) {
    throw new Error(
      'JWT_ACCESS_SECRET / JWT_REFRESH_SECRET 환경변수가 설정되지 않았습니다.',
    );
  }
  if (access === refresh) {
    throw new Error(
      'JWT_ACCESS_SECRET 와 JWT_REFRESH_SECRET 는 서로 달라야 합니다.',
    );
  }
}

/**
 * 소셜 로그인/JWT 설정.
 * provider별 자격증명이 있으면 enabled=true. 없으면 해당 provider는 비활성.
 */
export const authConfig = registerAs('auth', () => {
  assertJwtSecrets(process.env);

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientIds = [
    googleClientId,
    ...(process.env.GOOGLE_MOBILE_CLIENT_IDS ?? '').split(','),
  ]
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id));
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const appleClientId = process.env.APPLE_CLIENT_ID;
  const appleTeamId = process.env.APPLE_TEAM_ID;
  const appleKeyId = process.env.APPLE_KEY_ID;
  const applePrivateKey = process.env.APPLE_PRIVATE_KEY;

  return {
    google: {
      clientId: googleClientId,
      clientIds: [...new Set(googleClientIds)],
      // authorization code → refresh 토큰 교환에 필요(모바일 serverAuthCode)
      clientSecret: googleClientSecret,
      enabled: Boolean(googleClientId),
    },
    apple: {
      clientId: appleClientId,
      teamId: appleTeamId,
      keyId: appleKeyId,
      // .env에는 개행이 \n 로 저장되므로 실제 개행으로 복원
      privateKey: applePrivateKey?.replace(/\\n/g, '\n'),
      enabled: Boolean(appleClientId),
    },
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET,
      refreshSecret: process.env.JWT_REFRESH_SECRET,
      accessTtl: process.env.JWT_ACCESS_TTL ?? '30m',
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '14d',
    },
  };
});

export type AuthConfig = ReturnType<typeof authConfig>;
