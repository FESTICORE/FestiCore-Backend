# 백엔드 Sentry 오류 수집

Sentry의 `festicore-backend` 프로젝트에 NestJS HTTP 5xx 오류를 수집한다. Railway
`develop` 이벤트는 `stage`, `production` 이벤트는 `production` 환경으로 표시한다.
두 환경의 프로젝트는 같고 환경 태그로 구분한다.

## 환경변수

Railway의 **백엔드 서비스**에 다음 값을 develop과 production 각각 등록한다.

```text
SENTRY_DSN=<festicore-backend 프로젝트의 DSN>
```

프로젝트 ID는 `4512339826966608`이다. DSN은 저장소에 커밋하지 않는다. 값이 없으면
Sentry SDK를 초기화하지 않으며 API 동작은 유지한다. `RAILWAY_ENVIRONMENT_NAME`은
Railway가 제공하는 값을 사용한다.

## 수집 범위와 검증

`src/instrument.ts`에서 SDK를 한 번 초기화하고 `AllExceptionsFilter`에서 HTTP 5xx만
보낸다. 자동 수집과 성능 추적은 꺼서 같은 오류의 중복 전송을 막는다. 4xx는 보내지
않는다. 이벤트에는 원본 예외 메시지·스택, SQL, 요청 본문·헤더·URL, 사용자 정보,
breadcrumb을 넣지 않는다. 오류 종류와 HTTP 상태로만 묶이므로 상세 원인은 서버의
별도 로그를 확인한다.

배포 후 실제 5xx가 발생하면 Sentry `festicore-backend` 프로젝트에서 해당 환경의
이벤트를 확인한다. 검증을 위해 운영 API에 인위적인 5xx 경로를 추가하지 않는다.

```sh
npm test -- --runInBand src/instrument.spec.ts src/common/filters/all-exceptions.filter.spec.ts
npm run build
```
