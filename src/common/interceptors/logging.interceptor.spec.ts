import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

it('OAuth 인가 코드가 포함된 쿼리를 요청 로그에서 제거한다', async () => {
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  try {
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          originalUrl:
            '/api/v1/auth/google/callback?code=secret-code&state=secret-state',
        }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of(undefined) } as CallHandler;

    await firstValueFrom(new LoggingInterceptor().intercept(context, next));

    const line = String(log.mock.calls[0][0]);
    expect(line).toContain('GET /api/v1/auth/google/callback 200');
    expect(line).not.toContain('secret-code');
    expect(line).not.toContain('secret-state');
  } finally {
    log.mockRestore();
  }
});
