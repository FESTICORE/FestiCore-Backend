import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { API_DOMAINS } from './common/api-domains';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { AdminAuthModule } from './modules/admin/auth/admin-auth.module';
import { AdminFestivalModule } from './modules/admin/festival/admin-festival.module';
import { FlagsModule } from './modules/flags/flags.module';
import { PublicFestivalModule } from './modules/public/public-festival.module';
import { CrewModule } from './modules/crews/crew.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { CrawlModule } from './modules/admin/crawl/crawl.module';
import { DeviceModule } from './modules/device/device.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { AdminAuditModule } from './modules/admin/audit/admin-audit.module';
import { AdminPushModule } from './modules/admin/push/admin-push.module';

/** SwaggerModule.createDocument 의 include 가 받는 모듈 클래스 타입. */
type ModuleClass = new (...args: never[]) => unknown;

/** slug → 문서에 포함할 모듈. 도메인 정의 자체는 common/api-domains 가 소유한다. */
const MODULES_BY_SLUG: Record<string, ModuleClass[]> = {
  health: [HealthModule],
  auth: [AuthModule],
  'admin-accounts': [AdminAuthModule],
  'admin-festivals': [AdminFestivalModule],
  'admin-crawl': [CrawlModule],
  'admin-proposals': [CrawlModule],
  flags: [FlagsModule],
  festivals: [PublicFestivalModule],
  crews: [CrewModule],
  schedule: [ScheduleModule],
  devices: [DeviceModule],
  notifications: [DeviceModule],
  metrics: [MetricsModule],
  'admin-metrics': [MetricsModule],
  'admin-audit': [AdminAuditModule],
  'admin-push': [AdminPushModule],
};

const DOMAIN_DOCS = API_DOMAINS.map((d) => ({
  slug: d.slug,
  title: `FestiCore ${d.title} API`,
  description: d.description,
  modules: MODULES_BY_SLUG[d.slug] ?? [],
}));
const PUBLIC_DOCS = DOMAIN_DOCS.filter((doc) => !doc.slug.startsWith('admin-'));
const ADMIN_DOCS = [
  ...DOMAIN_DOCS.filter((doc) => doc.slug.startsWith('admin-')).map((doc) => ({
    ...doc,
    slug: doc.slug.slice('admin-'.length),
  })),
  {
    slug: 'flags',
    title: 'FestiCore Admin Flags API',
    description: '관리자용 기수 코드 발급·조회, 신고 목록 및 깃발 숨김 처리',
    modules: [FlagsModule],
  },
];

function isAdminPath(path: string): boolean {
  return /^\/(?:api\/v1\/)?admin(?:\/|$)/.test(path);
}

function onlyAudience(document: OpenAPIObject, admin: boolean): OpenAPIObject {
  document.paths = Object.fromEntries(
    Object.entries(document.paths).filter(
      ([path]) => isAdminPath(path) === admin,
    ),
  );
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      for (const [status, response] of Object.entries(
        operation.responses ?? {},
      )) {
        const statusCode = Number(status);
        if (
          !Number.isInteger(statusCode) ||
          statusCode < 200 ||
          statusCode === 204 ||
          statusCode === 205 ||
          statusCode === 304 ||
          (path.endsWith('/metrics/events') && statusCode === 202) ||
          (statusCode < 400 && statusCode >= 300) ||
          (path.endsWith('/auth/web/result') && statusCode === 200) ||
          !response ||
          '$ref' in response
        )
          continue;
        const content = response.content;
        if (content && !content['application/json']) continue;
        const json = content?.['application/json'];
        const schema = json?.schema;
        const example: unknown =
          schema && 'example' in schema ? schema.example : null;
        const envelopeExample =
          example && typeof example === 'object' && !Array.isArray(example)
            ? (example as Record<string, unknown>)
            : null;
        if (
          schema &&
          'properties' in schema &&
          schema.properties?.code &&
          schema.properties?.data &&
          schema.properties?.message
        )
          continue;
        if (
          envelopeExample &&
          'code' in envelopeExample &&
          'data' in envelopeExample &&
          'message' in envelopeExample
        ) {
          response.content = {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code', 'data', 'message'],
                additionalProperties: false,
                properties: {
                  code: { type: 'string', example: envelopeExample.code },
                  data: {
                    type: 'object',
                    nullable: true,
                    example: envelopeExample.data,
                  },
                  message: {
                    type: 'string',
                    example: envelopeExample.message,
                  },
                },
                example: envelopeExample,
              },
            },
          };
          continue;
        }
        const businessCode =
          statusCode >= 400 && typeof envelopeExample?.code === 'string'
            ? envelopeExample.code
            : null;
        const errorDetails = businessCode
          ? Object.fromEntries(
              Object.entries(envelopeExample ?? {}).filter(
                ([key]) => key !== 'code' && key !== 'message',
              ),
            )
          : null;
        response.content = {
          'application/json': {
            schema: {
              type: 'object',
              required: ['code', 'data', 'message'],
              properties: {
                code: businessCode
                  ? { type: 'string', example: businessCode }
                  : statusCode < 400
                    ? { type: 'string', example: 'SUCCESS' }
                    : { type: 'string' },
                data: errorDetails
                  ? { type: 'object', example: errorDetails }
                  : (schema ?? { nullable: true }),
                message:
                  businessCode && typeof envelopeExample?.message === 'string'
                    ? { type: 'string', example: envelopeExample.message }
                    : { type: 'string' },
              },
            },
          },
        };
      }
    }
  }
  if (admin) {
    for (const pathItem of Object.values(document.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const operation = pathItem?.[method];
        if (!operation) continue;
        if (!operation.security?.some((security) => 'bearer' in security)) {
          operation.security = [...(operation.security ?? []), { bearer: [] }];
        }
      }
    }
  }
  return document;
}

const UI_OPTIONS = {
  explorer: true,
  swaggerOptions: {
    docExpansion: 'list',
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
  },
};

/**
 * 공개 API와 관리자 API 문서를 분리하고 도메인별 문서를 제공한다.
 *
 * - `/api-docs`                 공개 API
 * - `/admin/api-docs`           관리자 API
 * - 각 루트의 `/auth`, `/flags` 등은 해당 도메인만
 *
 * 모든 문서는 단일 Gateway origin을 서버로 사용한다. 도메인은 URL path로만 구분한다.
 */
export function setupSwagger(
  app: INestApplication,
  opts: { publicUrl?: string; port: number; isProd: boolean },
): void {
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (/^\/(?:admin\/)?api-docs(?:\/|-|$)/.test(request.path)) {
      response.setHeader('Cache-Control', 'no-store, max-age=0');
    }
    next();
  });

  const gatewayServer = (): string => {
    if (!opts.isProd) return `http://localhost:${opts.port}`;
    if (!opts.publicUrl) return '/';
    return opts.publicUrl.replace(/\/$/, '');
  };

  const build = (title: string, description: string) => {
    const builder = new DocumentBuilder()
      .setTitle(title)
      .setDescription(description)
      .setVersion('1.0.0')
      .addServer(gatewayServer(), 'Gateway');
    builder.addBearerAuth();
    return builder.build();
  };

  const uiOptionsFor = (basePath: string, docs: typeof DOMAIN_DOCS) => ({
    explorer: true,
    swaggerOptions: {
      ...UI_OPTIONS.swaggerOptions,
      urls: [
        { name: '전체', url: `/${basePath}-json` },
        ...docs.map((doc) => ({
          name: doc.title,
          url: `/${basePath}/${doc.slug}-json`,
        })),
      ],
      'urls.primaryName': '전체',
    },
  });

  SwaggerModule.setup(
    'api-docs',
    app,
    onlyAudience(
      SwaggerModule.createDocument(
        app,
        build('FestiCore Public API', '로그인, 내 계정, 깃발 등 앱 공개 API'),
        {
          deepScanRoutes: false,
          include: PUBLIC_DOCS.flatMap((doc) => doc.modules),
        },
      ),
      false,
    ),
    uiOptionsFor('api-docs', PUBLIC_DOCS),
  );

  SwaggerModule.setup(
    'admin/api-docs',
    app,
    onlyAudience(
      SwaggerModule.createDocument(
        app,
        build(
          'FestiCore Admin API',
          '관리자 권한·축제 관리·기수 코드와 신고 처리 API',
        ),
        {
          deepScanRoutes: false,
          include: ADMIN_DOCS.flatMap((doc) => doc.modules),
        },
      ),
      true,
    ),
    uiOptionsFor('admin/api-docs', ADMIN_DOCS),
  );

  // FlagsModule에는 일반 사용자와 관리자 컨트롤러가 함께 있으므로
  // 도메인 문서도 실제 URL 기준으로 분리한다.
  for (const { docs, basePath, admin } of [
    { docs: PUBLIC_DOCS, basePath: 'api-docs', admin: false },
    { docs: ADMIN_DOCS, basePath: 'admin/api-docs', admin: true },
  ]) {
    for (const doc of docs) {
      const document = onlyAudience(
        SwaggerModule.createDocument(app, build(doc.title, doc.description), {
          deepScanRoutes: false,
          include: doc.modules,
        }),
        admin,
      );
      if (
        admin &&
        (doc.slug === 'crawl' ||
          doc.slug === 'proposals' ||
          doc.slug === 'metrics')
      ) {
        const prefix = new RegExp(`^/(?:api/v1/)?admin/${doc.slug}(?:/|$)`);
        document.paths = Object.fromEntries(
          Object.entries(document.paths).filter(([path]) => prefix.test(path)),
        );
      }
      if (
        !admin &&
        (doc.slug === 'devices' ||
          doc.slug === 'notifications' ||
          doc.slug === 'metrics')
      ) {
        const prefix = new RegExp(`^/(?:api/v1/)?${doc.slug}(?:/|$)`);
        document.paths = Object.fromEntries(
          Object.entries(document.paths).filter(([path]) => prefix.test(path)),
        );
      }
      SwaggerModule.setup(`${basePath}/${doc.slug}`, app, document, UI_OPTIONS);
    }
  }
}
