import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { decodeJwt } from 'jose';
import type { OauthGrant, SocialProfile } from '../types/social-profile';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/**
 * Google OAuth 서비스.
 * - idToken 검증(로그인)
 * - serverAuthCode → refresh 토큰 교환(저장용)
 * - refresh 토큰 revoke(회원 탈퇴 시 연동 해제)
 */
@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);
  private readonly clientId?: string;
  private readonly clientIds: string[];
  private readonly clientSecret?: string;
  private readonly enabled: boolean;
  private readonly client: OAuth2Client;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('auth.google.clientId');
    this.clientIds =
      this.config.get<string[]>('auth.google.clientIds') ??
      (this.clientId ? [this.clientId] : []);
    this.clientSecret = this.config.get<string>('auth.google.clientSecret');
    this.enabled = this.config.get<boolean>('auth.google.enabled') ?? false;
    this.client = new OAuth2Client(this.clientId);
  }

  async verify(idToken: string): Promise<SocialProfile> {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Google 로그인이 설정되지 않았습니다.',
      );
    }
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientIds,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub) {
        throw new Error('payload에 sub가 없습니다.');
      }
      return {
        provider: 'google',
        providerId: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
      };
    } catch (error) {
      this.logger.warn(`Google idToken 검증 실패: ${(error as Error).message}`);
      throw new UnauthorizedException('유효하지 않은 Google 토큰입니다.');
    }
  }

  /**
   * serverAuthCode를 Google refresh 토큰으로 교환한다(교환 결과의 사용자 sub 포함).
   * clientSecret이 없으면 undefined(연동 저장 생략).
   */
  async exchangeAuthCode(authCode: string): Promise<OauthGrant | undefined> {
    if (!this.clientId || !this.clientSecret) return undefined;

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: authCode,
      grant_type: 'authorization_code',
      // 모바일 serverAuthCode 교환 시 redirect_uri는 빈 값
      redirect_uri: '',
    });

    try {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        this.logger.warn(`Google 토큰 교환 실패: ${res.status}`);
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
      this.logger.warn(`Google 토큰 교환 오류: ${(error as Error).message}`);
      return undefined;
    }
  }

  /**
   * refresh 토큰으로 Google 연동을 해제한다(회원 탈퇴).
   * 실패해도 예외를 던지지 않는다(계정 삭제는 계속 진행).
   */
  async revokeConnection(refreshToken: string): Promise<void> {
    const body = new URLSearchParams({ token: refreshToken });
    try {
      const res = await fetch(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        this.logger.warn(`Google 연동 해제 실패: ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Google 연동 해제 오류: ${(error as Error).message}`);
    }
  }
}
