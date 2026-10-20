import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
      success: false,
      statusCode: 400,
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

  it('Railway production 환경은 DEV_LOGIN_ENABLED 와 무관하게 바디 미기록', () => {
    const { host } = hostFor(badLogin);
    new AllExceptionsFilter(
      configOf({
        NODE_ENV: 'production',
        RAILWAY_ENVIRONMENT_NAME: 'production',
        DEV_LOGIN_ENABLED: 'true',
      }),
    ).catch(new BadRequestException('bad'), host);
    expect(String((warn.mock.calls as unknown[][])[0][0])).not.toContain(
      'body=',
    );
  });
});
