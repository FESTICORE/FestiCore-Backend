import { INestApplication } from '@nestjs/common';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { setupSwagger } from './swagger';
import { AdminPushModule } from './modules/admin/push/admin-push.module';

jest.mock('./modules/auth/auth.module', () => ({ AuthModule: class {} }));
jest.mock('./modules/health/health.module', () => ({ HealthModule: class {} }));
jest.mock('./modules/admin/auth/admin-auth.module', () => ({
  AdminAuthModule: class {},
}));
jest.mock('./modules/admin/festival/admin-festival.module', () => ({
  AdminFestivalModule: class {},
}));
jest.mock('./modules/admin/push/admin-push.module', () => ({
  AdminPushModule: class {},
}));
jest.mock('./modules/flags/flags.module', () => ({ FlagsModule: class {} }));
jest.mock('./modules/metrics/metrics.module', () => ({
  MetricsModule: class {},
}));

describe('Swagger 문서 분리', () => {
  afterEach(() => jest.restoreAllMocks());

  it('공개·관리자 UI와 JSON에 각 대상의 경로만 포함한다', () => {
    const paths = {
      '/api/v1/health': { get: { responses: { 200: { description: 'OK' } } } },
      '/api/v1/auth/login': {
        post: { responses: { 200: { description: 'OK' } } },
      },
      '/api/v1/flags': { get: { responses: { 200: { description: 'OK' } } } },
      '/api/v1/festivals': {
        get: {
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    example: {
                      code: 'SUCCESS',
                      data: { items: [] },
                      message: '성공적으로 처리되었습니다.',
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/devices': {
        put: { responses: { 200: { description: 'OK' } } },
      },
      '/api/v1/notifications/subscriptions': {
        get: { responses: { 200: { description: 'OK' } } },
      },
      '/api/v1/metrics/events': {
        post: { responses: { 202: { description: 'Accepted' } } },
      },
      '/api/v1/admin/metrics': {
        get: { responses: { 200: { description: 'OK' } } },
      },
      '/api/v1/admin/audit': {
        get: { responses: { 200: { description: 'OK' } } },
      },
      '/api/v1/admin/admins': {
        get: { responses: { 200: { description: 'OK' } } },
      },
      '/api/v1/admin/flags/reported': {
        get: { responses: { 200: { description: 'OK' } } },
      },
    };
    jest
      .spyOn(SwaggerModule, 'createDocument')
      .mockImplementation((_app, config) => ({
        openapi: '3.0.0',
        info: { title: 'test', version: '1', description: '' },
        paths: { ...paths },
        components: {
          ...config.components,
          schemas: { Flag: { type: 'object' } },
        },
      }));
    const setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation();

    type CacheMiddleware = (
      request: { path: string },
      response: { setHeader: jest.Mock },
      next: jest.Mock,
    ) => void;
    const use = jest.fn<void, [CacheMiddleware]>();
    setupSwagger({ use } as unknown as INestApplication, {
      port: 3000,
      isProd: false,
    });
    const cacheMiddleware = use.mock.calls[0][0];
    const setHeader = jest.fn();
    const next = jest.fn();
    cacheMiddleware({ path: '/api-docs/festivals-json' }, { setHeader }, next);
    expect(setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, max-age=0',
    );
    cacheMiddleware({ path: '/api/v1/festivals' }, { setHeader }, next);
    expect(setHeader).toHaveBeenCalledTimes(1);

    const documents = new Map(
      setup.mock.calls.map(([route, , document]) => [
        route,
        document as OpenAPIObject,
      ]),
    );
    const publicPaths = Object.keys(documents.get('api-docs')!.paths);
    const adminPaths = Object.keys(documents.get('admin/api-docs')!.paths);
    expect(publicPaths).toEqual([
      '/api/v1/health',
      '/api/v1/auth/login',
      '/api/v1/flags',
      '/api/v1/festivals',
      '/api/v1/devices',
      '/api/v1/notifications/subscriptions',
      '/api/v1/metrics/events',
    ]);
    expect(adminPaths).toEqual([
      '/api/v1/admin/metrics',
      '/api/v1/admin/audit',
      '/api/v1/admin/admins',
      '/api/v1/admin/flags/reported',
    ]);
    expect(Object.keys(documents.get('api-docs/flags')!.paths)).toEqual(
      publicPaths,
    );
    expect(Object.keys(documents.get('api-docs/devices')!.paths)).toEqual([
      '/api/v1/devices',
    ]);
    expect(Object.keys(documents.get('api-docs/notifications')!.paths)).toEqual(
      ['/api/v1/notifications/subscriptions'],
    );
    expect(Object.keys(documents.get('api-docs/metrics')!.paths)).toEqual([
      '/api/v1/metrics/events',
    ]);
    expect(Object.keys(documents.get('admin/api-docs/metrics')!.paths)).toEqual(
      ['/api/v1/admin/metrics'],
    );
    expect(Object.keys(documents.get('admin/api-docs/audit')!.paths)).toEqual(
      adminPaths,
    );
    expect(
      documents.get('api-docs')!.paths['/api/v1/metrics/events'].post
        ?.responses['202'],
    ).not.toHaveProperty('content');
    expect(Object.keys(documents.get('admin/api-docs/flags')!.paths)).toEqual(
      adminPaths,
    );
    const admin = documents.get('admin/api-docs')!;
    expect(admin.components!.schemas).toHaveProperty('Flag');
    expect(admin.components!.securitySchemes).toHaveProperty('bearer');
    expect(admin.components!.securitySchemes).not.toHaveProperty(
      'admin-session',
    );
    expect(
      documents.get('api-docs')!.components!.securitySchemes,
    ).toHaveProperty('bearer');
    expect(admin.paths['/api/v1/admin/admins'].get?.security).toContainEqual({
      bearer: [],
    });
    expect(
      admin.paths['/api/v1/admin/flags/reported'].get?.security,
    ).toContainEqual({
      bearer: [],
    });
    expect(
      documents.get('api-docs')!.paths['/api/v1/health'].get?.responses['200'],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['code', 'data', 'message'],
            properties: { code: { example: 'SUCCESS' } },
          },
        },
      },
    });
    expect(
      documents.get('api-docs')!.paths['/api/v1/festivals'].get?.responses[
        '200'
      ],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['code', 'data', 'message'],
            properties: {
              code: { type: 'string' },
              data: { type: 'object' },
              message: { type: 'string' },
            },
            example: {
              code: 'SUCCESS',
              data: { items: [] },
              message: '성공적으로 처리되었습니다.',
            },
          },
        },
      },
    });
    expect(documents.has('api-docs/admin-accounts')).toBe(false);
    expect(documents.has('admin/api-docs/accounts')).toBe(true);
  });

  it('테스트 푸시를 관리자 전체 및 전용 Swagger 문서에 포함한다', () => {
    jest
      .spyOn(SwaggerModule, 'createDocument')
      .mockImplementation((_app, config, options) => ({
        openapi: '3.0.0',
        info: { title: 'test', version: '1', description: '' },
        paths: {
          ...(options?.include?.includes(AdminPushModule)
            ? {
                '/api/v1/admin/push/test': {
                  post: { responses: { 201: { description: 'Accepted' } } },
                },
              }
            : {}),
        },
        components: config.components,
      }));
    const setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation();
    setupSwagger({ use: jest.fn() } as unknown as INestApplication, {
      port: 3000,
      isProd: false,
    });
    const documents = new Map(
      setup.mock.calls.map(([route, , document]) => [
        route,
        document as OpenAPIObject,
      ]),
    );
    expect(documents.get('admin/api-docs')?.paths).toHaveProperty(
      '/api/v1/admin/push/test',
    );
    expect(documents.get('admin/api-docs/push')?.paths).toHaveProperty(
      '/api/v1/admin/push/test',
    );
    expect(documents.get('api-docs')?.paths).not.toHaveProperty(
      '/api/v1/admin/push/test',
    );
  });
});
