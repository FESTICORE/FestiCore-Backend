import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostFor(body: unknown, url = '/api/v1/auth/login') {
  const json = jest.fn();
  const response = { status: jest.fn(() => ({ json })) };
  const request = { method: 'POST', url, body };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response, json };
}

function configOf(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

describe('AllExceptionsFilter', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  const badLogin = {
    provider: 'kakao',
    token: 'id-token-raw',
    authorizationCode: 'auth-code-raw',
  };

  it('400 → 표준 에러 포맷', () => {
    const { host, response, json } = hostFor(badLogin);
    new AllExceptionsFilter().catch(new BadRequestException('bad'), host);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 'BAD_REQUEST',
      data: null,
      message: 'bad',
    });
  });

  it('개발 환경 진단 로그는 인증 값을 가린다', () => {
    const { host } = hostFor(badLogin);
    new AllExceptionsFilter(configOf({ NODE_ENV: 'development' })).catch(
      new BadRequestException('bad'),
      host,
    );
    const logged = String((warn.mock.calls as unknown[][])[0][0]);
    expect(logged).toContain('body=');
    expect(logged).not.toContain('auth-code-raw');
    expect(logged).not.toContain('id-token-raw');
    expect(logged).toContain('kakao');
  });

  it('OAuth 콜백 URL의 code와 state를 로그에 남기지 않는다', () => {
    const { host } = hostFor(
      {},
      '/api/v1/auth/google/callback?code=secret-code&state=secret-state',
    );
    new AllExceptionsFilter().catch(new BadRequestException('bad'), host);
    const logged = String((warn.mock.calls as unknown[][])[0][0]);
    expect(logged).toContain('/api/v1/auth/google/callback - 400');
    expect(logged).not.toContain('secret-code');
    expect(logged).not.toContain('secret-state');
  });

  it('Apple form_post의 ID 토큰과 상태 및 사용자 정보를 숨긴다', () => {
    const { host } = hostFor(
      {
        id_token: 'apple-id-token-raw',
        state: 'apple-state-raw',
        user: '{"email":"private@example.com"}',
        nonce: 'apple-nonce-raw',
      },
      '/api/v1/auth/apple/callback',
    );
    new AllExceptionsFilter(configOf({ NODE_ENV: 'development' })).catch(
      new BadRequestException('bad'),
      host,
    );
    const logged = String((warn.mock.calls as unknown[][])[0][0]);
    expect(logged).toContain('body=');
    expect(logged).not.toContain('apple-id-token-raw');
    expect(logged).not.toContain('apple-state-raw');
    expect(logged).not.toContain('private@example.com');
    expect(logged).not.toContain('apple-nonce-raw');
  });

  it('기기 등록 오류의 APNs 토큰을 진단 로그에 남기지 않는다', () => {
    const { host } = hostFor(
      {
        apnsToken: 'private-apns-token',
        pushToken: 'private-push-token',
        liveActivityPushToStartToken: 'private-live-token',
      },
      '/api/v1/devices',
    );
    new AllExceptionsFilter(configOf({ NODE_ENV: 'development' })).catch(
      new BadRequestException('bad'),
      host,
    );
    const logged = String((warn.mock.calls as unknown[][])[0][0]);
    expect(logged).not.toContain('private-apns-token');
    expect(logged).not.toContain('private-push-token');
    expect(logged).not.toContain('private-live-token');
  });

  it('Railway production 환경은 진단 바디를 기록하지 않는다', () => {
    const { host } = hostFor(badLogin);
    new AllExceptionsFilter(
      configOf({
        NODE_ENV: 'production',
        RAILWAY_ENVIRONMENT_NAME: 'production',
      }),
    ).catch(new BadRequestException('bad'), host);
    expect(String((warn.mock.calls as unknown[][])[0][0])).not.toContain(
      'body=',
    );
  });

  it('매직 링크 값과 쿼리 토큰은 진단 로그에도 남기지 않는다', () => {
    const { host } = hostFor(
      { magicToken: 'secret-magic', email: 'admin@example.com' },
      '/api/v1/admin/auth/callback?token=secret-query',
    );
    new AllExceptionsFilter(configOf({ NODE_ENV: 'development' })).catch(
      new BadRequestException('bad'),
      host,
    );
    const logged = String((warn.mock.calls as unknown[][])[0][0]);
    expect(logged).not.toContain('secret-magic');
    expect(logged).not.toContain('secret-query');
    expect(logged).not.toContain('admin@example.com');
  });

  it('초안 충돌 응답의 버전과 현재 초안을 전달한다', () => {
    const { host, json } = hostFor({});
    new AllExceptionsFilter().catch(
      new BadRequestException({
        message: '초안 충돌',
        code: 'DRAFT_CONFLICT',
        draftVersion: 2,
        draft: { name: '현재 초안' },
        internalSecret: 'never-expose',
      }),
      host,
    );
    expect(json).toHaveBeenCalledWith({
      data: { draftVersion: 2, draft: { name: '현재 초안' } },
      message: '초안 충돌',
      code: 'DRAFT_CONFLICT',
    });
  });

  it('일정 충돌 시 현재 일정만 노출한다', () => {
    const { host, json } = hostFor({});
    new AllExceptionsFilter().catch(
      new ConflictException({
        code: 'STATUS_STALE',
        message: '더 최신 일정이 저장되어 있습니다.',
        current: {
          setIds: ['set_a1b2c3d4'],
          updatedAt: new Date('2026-10-20T03:00:00Z'),
          secret: 'hidden',
        },
      }),
      host,
    );
    expect(json).toHaveBeenCalledWith({
      data: {
        current: {
          setIds: ['set_a1b2c3d4'],
          updatedAt: '2026-10-20T03:00:00.000Z',
        },
      },
      code: 'STATUS_STALE',
      message: '더 최신 일정이 저장되어 있습니다.',
    });
  });

  it('DB 오류의 SQL 매개변수와 드라이버 메시지를 로그에 남기지 않는다', () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      const { host, json } = hostFor({}, '/api/v1/auth/login');
      const secret = 'oauth-refresh-token-raw';
      const error = new QueryFailedError(
        'INSERT INTO users (oauthRefreshToken) VALUES ($1)',
        [secret],
        new Error(`database rejected ${secret}`),
      );

      new AllExceptionsFilter().catch(error, host);

      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        'oauthRefreshToken',
      );
      expect(json).toHaveBeenCalledWith({
        code: 'INTERNAL_SERVER_ERROR',
        data: null,
        message: '내부 서버 오류가 발생했습니다.',
      });
    } finally {
      errorLog.mockRestore();
    }
  });
});
