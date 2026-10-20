export type SocialProvider = 'google' | 'apple';

/** provider 서비스가 토큰 검증 후 반환하는 공통 프로필 */
export interface SocialProfile {
  provider: SocialProvider;
  providerId: string; // provider 고유 식별자(sub)
  email?: string;
  name?: string;
  picture?: string; // provider가 제공하는 프로필 사진 원본 URL
}

/** authorization code 교환 결과. subject 는 교환된 토큰의 provider 사용자(sub). */
export interface OauthGrant {
  refreshToken: string;
  subject?: string;
}

/** JWT access 토큰 페이로드 및 가드가 주입하는 요청 사용자 */
export interface AuthUser {
  userId: string;
  provider: SocialProvider;
}
