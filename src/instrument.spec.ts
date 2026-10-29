type InitOptions = {
  environment: string;
  defaultIntegrations: boolean;
  integrations: unknown[];
  tracesSampleRate: number;
  beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
};

const mockInit = jest.fn<void, [InitOptions]>();

jest.mock('@sentry/nestjs', () => ({ init: mockInit }));

describe('Sentry 초기화', () => {
  const originalDsn = process.env.SENTRY_DSN;
  const originalEnvironment = process.env.RAILWAY_ENVIRONMENT_NAME;
  const originalNodeEnvironment = process.env.NODE_ENV;

  afterEach(() => {
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
    if (originalEnvironment === undefined)
      delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME = originalEnvironment;
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnvironment;
    mockInit.mockClear();
    jest.resetModules();
  });

  it('DSN이 없으면 SDK를 초기화하지 않는다', () => {
    delete process.env.SENTRY_DSN;
    jest.isolateModules(() => {
      void jest.requireActual('./instrument');
    });
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('Railway develop을 stage로 분리하고 요청 개인정보를 제거한다', () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/123';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'develop';
    jest.isolateModules(() => {
      void jest.requireActual('./instrument');
    });
    expect(mockInit).toHaveBeenCalledTimes(1);
    const options = mockInit.mock.calls[0][0];
    expect(options.environment).toBe('stage');
    expect(options.defaultIntegrations).toBe(false);
    expect(options.integrations).toEqual([]);
    expect(options.tracesSampleRate).toBe(0);
    const event = {
      message: 'HTTP 500: Error',
      request: { headers: { authorization: 'private' } },
      user: { email: 'private@example.com' },
      contexts: { secret: 'private' },
      extra: { sql: 'private' },
      breadcrumbs: [{ message: 'private' }],
      tags: { credential: 'private' },
      transaction: '/api/v1/private-id',
    };
    expect(options.beforeSend(event)).toEqual({ message: 'HTTP 500: Error' });
  });

  it('Railway production을 production으로 표시한다', () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/123';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    jest.isolateModules(() => {
      void jest.requireActual('./instrument');
    });
    expect(mockInit.mock.calls[0][0]).toMatchObject({
      environment: 'production',
    });
  });
});
