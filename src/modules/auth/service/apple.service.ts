import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  decodeJwt,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose';
import type { OauthGrant, SocialProfile } from '../types/social-profile';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

/**
 * Apple OAuth 서비스.
 * - identityToken(JWT) 검증(로그인)
 * - authorizationCode → refresh 토큰 교환(저장용)
 * - refresh 토큰 revoke(회원 탈퇴 시 연동 해제, App Store 5.1.1 요건)
 */
@Injectable()
export class AppleService {
  private readonly logger = new Logger(AppleService.name);
  private readonly clientId?: string;
  private readonly teamId?: string;
  private readonly keyId?: string;
  private readonly privateKey?: string;
  private readonly enabled: boolean;
  private readonly jwks: JWTVerifyGetKey = createRemoteJWKSet(APPLE_JWKS_URL);

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('auth.apple.clientId');
    this.teamId = this.config.get<string>('auth.apple.teamId');
    this.keyId = this.config.get<string>('auth.apple.keyId');
    this.privateKey = this.config.get<string>('auth.apple.privateKey');
    this.enabled = this.config.get<boolean>('auth.apple.enabled') ?? false;
  }

  async verify(identityToken: string, name?: string): Promise<SocialProfile> {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Apple 로그인이 설정되지 않았습니다.',
      );
    }
    try {
      const { payload } = await jwtVerify(identityToken, this.jwks, {
        issuer: APPLE_ISSUER,
        audience: this.clientId,
      });
      if (!payload.sub) {
        throw new Error('payload에 sub가 없습니다.');
      }
      return {
        provider: 'apple',
        providerId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        name,
      };
    } catch (error) {
      this.logger.warn(
        `Apple identityToken 검증 실패: ${(error as Error).message}`,
      );
      throw new UnauthorizedException('유효하지 않은 Apple 토큰입니다.');
    }
  }

  /** Apple Services ID 전용 웹 code 교환 및 nonce 검증. */
  async exchangeWebCode(
    code: string,
    redirectUri: string,
    nonce: string,
  ): Promise<{ profile: SocialProfile; grant?: OauthGrant }> {
    const webClientId = this.config.get<string>('APPLE_WEB_CLIENT_ID');
    const clientSecret = await this.buildClientSecret(webClientId);
    if (!webClientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'Apple 웹 로그인이 설정되지 않았습니다.',
      );
    }
    const res = await fetch(APPLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: webClientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok)
      throw new UnauthorizedException('Apple 인증 코드 교환에 실패했습니다.');
    const tokens = (await res.json()) as {
      id_token?: string;
      refresh_token?: string;
    };
    if (!tokens.id_token)
      throw new UnauthorizedException('Apple ID 토큰이 없습니다.');
    const { payload } = await jwtVerify(tokens.id_token, this.jwks, {
      issuer: APPLE_ISSUER,
      audience: webClientId,
    });
    if (!payload.sub || payload.nonce !== nonce) {
      throw new UnauthorizedException('Apple nonce가 일치하지 않습니다.');
    }
    return {
      profile: {
        provider: 'apple',
        providerId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
      },
      grant: tokens.refresh_token
        ? { refreshToken: tokens.refresh_token, subject: payload.sub }
        : undefined,
    };
  }

  /**
   * authorizationCode를 Apple refresh 토큰으로 교환한다(교환 결과의 사용자 sub 포함).
   * 자격증명(teamId/keyId/privateKey)이 없으면 undefined를 반환(연동 저장 생략).
   */
  async exchangeAuthCode(
    authorizationCode: string,
  ): Promise<OauthGrant | undefined> {
    const clientSecret = await this.buildClientSecret();
    if (!clientSecret || !this.clientId) return undefined;

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    });

    try {
      const res = await fetch(APPLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        this.logger.warn(`Apple 토큰 교환 실패: ${res.status}`);
        return undefined;
      }
      const json = (await res.json()) as {
        refresh_token?: string;
        id_token?: string;
      };
      if (!json.refresh_token) return undefined;
      // 토큰 엔드포인트가 TLS 로 직접 돌려준 id_token 이라 서명 재검증 없이 sub 만 읽는다.
      return {
        refreshToken: json.refresh_token,
        subject: json.id_token ? decodeJwt(json.id_token).sub : undefined,
      };
    } catch (error) {
      this.logger.warn(`Apple 토큰 교환 오류: ${(error as Error).message}`);
      return undefined;
    }
  }

  /**
   * refresh 토큰으로 Apple 연동을 해제한다(회원 탈퇴).
   * 실패해도 예외를 던지지 않는다(계정 삭제는 계속 진행).
   */
  async revokeConnection(refreshToken: string): Promise<void> {
    const clientSecret = await this.buildClientSecret();
    if (!clientSecret || !this.clientId) return;

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: clientSecret,
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });

    try {
      const res = await fetch(APPLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        this.logger.warn(`Apple 연동 해제 실패: ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Apple 연동 해제 오류: ${(error as Error).message}`);
    }
  }

  /** Apple client secret(ES256 JWT) 생성. 자격증명 미비 시 undefined. */
  private async buildClientSecret(
    clientId = this.clientId,
  ): Promise<string | undefined> {
    if (!clientId || !this.teamId || !this.keyId || !this.privateKey) {
      return undefined;
    }
    try {
      const key = await importPKCS8(this.privateKey, 'ES256');
      return await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
        .setIssuer(this.teamId)
        .setIssuedAt()
        .setExpirationTime('5m')
        .setAudience(APPLE_ISSUER)
        .setSubject(clientId)
        .sign(key);
    } catch (error) {
      this.logger.error(
        `Apple client secret 생성 실패: ${(error as Error).message}`,
      );
      return undefined;
    }
  }
}
