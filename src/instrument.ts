import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  const railwayEnvironment = process.env.RAILWAY_ENVIRONMENT_NAME;
  const environment =
    railwayEnvironment === 'develop'
      ? 'stage'
      : railwayEnvironment === 'production'
        ? 'production'
        : (process.env.NODE_ENV ?? 'development');

  Sentry.init({
    dsn,
    environment,
    // HTTP 오류는 전역 예외 필터에서 한 번만 수집한다.
    defaultIntegrations: false,
    integrations: [],
    tracesSampleRate: 0,
    beforeSend(event) {
      // 인증 헤더, URL 쿼리, 요청 본문, 사용자 정보, SQL 문맥은 전송하지 않는다.
      delete event.request;
      delete event.user;
      delete event.contexts;
      delete event.extra;
      delete event.breadcrumbs;
      delete event.tags;
      delete event.transaction;
      return event;
    },
  });
}
