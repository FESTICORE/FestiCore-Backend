import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_DOMAINS } from './common/api-domains';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { AdminAuthModule } from './modules/admin/auth/admin-auth.module';
import { AdminFestivalModule } from './modules/admin/festival/admin-festival.module';

/** SwaggerModule.createDocument 의 include 가 받는 모듈 클래스 타입. */
type ModuleClass = new (...args: never[]) => unknown;

/** slug → 문서에 포함할 모듈. 도메인 정의 자체는 common/api-domains 가 소유한다. */
const MODULES_BY_SLUG: Record<string, ModuleClass[]> = {
  health: [HealthModule],
  auth: [AuthModule],
  'admin-auth': [AdminAuthModule],
  'admin-festivals': [AdminFestivalModule],
};

const DOMAIN_DOCS = API_DOMAINS.map((d) => ({
  slug: d.slug,
  title: `FestiCore ${d.title} API`,
  description: d.description,
  modules: MODULES_BY_SLUG[d.slug] ?? [],
}));

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
 * Swagger 문서를 전체 1개 + 도메인별로 나눠 띄운다.
 *
 * - `/api-docs`            전체 API
 * - `/api-docs/auth` 등     해당 도메인만
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

  const build = (title: string, description: string) =>
    new DocumentBuilder()
      .setTitle(title)
      .setDescription(description)
      .setVersion('1.0.0')
      .addBearerAuth()
      .addServer(gatewayServer(), 'Gateway')
      .build();

  // 상단 정의 선택 드롭다운: 도메인을 고르면 해당 도메인 문서로 전환되어
  // 그 도메인 엔드포인트만 표시된다. '전체'는 모든 엔드포인트.
  const fullUiOptions = {
    explorer: true,
    swaggerOptions: {
      ...UI_OPTIONS.swaggerOptions,
      urls: [
        { name: '전체 (All)', url: '/api-docs-json' },
        ...API_DOMAINS.map((d) => ({
          name: d.title,
          url: `/api-docs/${d.slug}-json`,
        })),
      ],
      'urls.primaryName': '전체 (All)',
    },
  };

  SwaggerModule.setup(
    'api-docs',
    app,
    SwaggerModule.createDocument(
      app,
      build('FestiCore API', 'FestiCore 백엔드 전체 API 문서'),
      { deepScanRoutes: true },
    ),
    fullUiOptions,
  );

  // 도메인별 문서.
  for (const doc of DOMAIN_DOCS) {
    SwaggerModule.setup(
      `api-docs/${doc.slug}`,
      app,
      SwaggerModule.createDocument(
        app,
        build(doc.title, doc.description),
        // deepScanRoutes:false — import한 다른 도메인 모듈의 컨트롤러까지
        // 딸려오지 않도록 해당 모듈 자기 라우트만 문서화한다.
        { deepScanRoutes: false, include: doc.modules },
      ),
      UI_OPTIONS,
    );
  }
}
