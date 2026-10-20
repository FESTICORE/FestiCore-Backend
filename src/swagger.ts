import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { API_DOMAINS } from './common/api-domains';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { AdminAuthModule } from './modules/admin/auth/admin-auth.module';
import { AdminFestivalModule } from './modules/admin/festival/admin-festival.module';
import { FlagsModule } from './modules/flags/flags.module';
import { PublicFestivalModule } from './modules/public/public-festival.module';
import { CrewModule } from './modules/crews/crew.module';
import { ScheduleModule } from './modules/schedule/schedule.module';

/** SwaggerModule.createDocument 의 include 가 받는 모듈 클래스 타입. */
type ModuleClass = new (...args: never[]) => unknown;

/** slug → 문서에 포함할 모듈. 도메인 정의 자체는 common/api-domains 가 소유한다. */
const MODULES_BY_SLUG: Record<string, ModuleClass[]> = {
  health: [HealthModule],
  auth: [AuthModule],
  'admin-auth': [AdminAuthModule],
  'admin-festivals': [AdminFestivalModule],
  flags: [FlagsModule],
  festivals: [PublicFestivalModule],
  crews: [CrewModule],
  schedule: [ScheduleModule],
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
  if (admin) {
    for (const [path, pathItem] of Object.entries(document.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const operation = pathItem?.[method];
        if (!operation) continue;
        const publicLogin =
          (method === 'post' && path.endsWith('/admin/auth/magic-link')) ||
          (path.endsWith('/admin/auth/callback') &&
            (method === 'get' || method === 'post'));
        if (publicLogin) continue;
        if (
          !operation.security?.some((security) => 'admin-session' in security)
        ) {
          operation.security = [
            ...(operation.security ?? []),
            { 'admin-session': [] },
          ];
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
  const gatewayServer = (): string => {
    if (!opts.isProd) return `http://localhost:${opts.port}`;
    if (!opts.publicUrl) return '/';
    return opts.publicUrl.replace(/\/$/, '');
  };

  const build = (title: string, description: string, admin = false) => {
    const builder = new DocumentBuilder()
      .setTitle(title)
      .setDescription(description)
      .setVersion('1.0.0')
      .addServer(gatewayServer(), 'Gateway');
    if (admin) {
      builder.addCookieAuth(
        'festicore_admin_session',
        { type: 'apiKey', in: 'cookie', name: 'festicore_admin_session' },
        'admin-session',
      );
    } else {
      builder.addBearerAuth();
    }
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
          '관리자 로그인·세션, 축제 관리, 기수 코드와 신고 처리 API',
          true,
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
      SwaggerModule.setup(
        `${basePath}/${doc.slug}`,
        app,
        onlyAudience(
          SwaggerModule.createDocument(
            app,
            build(doc.title, doc.description, admin),
            { deepScanRoutes: false, include: doc.modules },
          ),
          admin,
        ),
        UI_OPTIONS,
      );
    }
  }
}
