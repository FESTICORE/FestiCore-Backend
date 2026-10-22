# API v0.2 구현·검증 목록

기준: 로컬 `FESTICORE_API명세서_v0.2.pdf` 40쪽, [.spec/api-v0.2-adoption.md](api-v0.2-adoption.md), 현재 `develop` 소스. 이 문서는 경로 존재, 자동 테스트, 배포 동작을 구분한다. 공통 접두사는 `/api/v1`이다.

## 구현 목록

| 영역 | 현재 제공하는 API | 자동 검증 근거 |
| --- | --- | --- |
| 인증·내 정보 | `POST /auth/login`, `/auth/refresh`, `/auth/logout`; Apple 웹 OAuth 시작·콜백·결과·토큰; `GET/PATCH/DELETE /me` | `test/auth.e2e-spec.ts`, `test/web-oauth.e2e-spec.ts`, `test/me.e2e-spec.ts` |
| 축제 | `GET /festivals`, `/:id`, `/:id/pack`, `/:id/pack/version`, `/:id/flags`, `/:id/live`; 공개 포스터·지도 이미지 | `test/public-api.e2e-spec.ts`, 공개 이미지 컨트롤러 테스트 |
| 기기·알림 | `GET/PUT/DELETE /devices`, Live Activity 토큰 등록·삭제, 알림 구독 조회·변경·삭제·팩 수신 기록 | 기기 서비스·컨트롤러, 알림 서비스 단위 테스트 |
| 깃발·크루·시간표 | 깃발 상세·팔로우·신고·기수 상태/사진/공동기수, 크루 생성·가입·상태·멤버 관리, `GET/PUT /me/schedule/:festivalId` | `test/flags.e2e-spec.ts`, `test/crews.e2e-spec.ts`, 일정 서비스 테스트 |
| 관리자 | 축제 초안·발행·버전·롤백, 지도/OCR, 크롤 소스·실행·이미지·제안·장애, 깃발 관리, 관리자 계정·감사·테스트 푸시·메트릭 | 관리자 권한·크롤 이미지 E2E, 크롤 서비스 테스트 |
| 실시간 | `/api/v1/festivals/updates` WebSocket의 `pack.updated` | 게이트웨이 업그레이드·Origin·연결 제한 단위 테스트 |

현재 컨트롤러 선언은 HTTP 98개다. 공개 Swagger는 `/api-docs`, 관리자 Swagger는 `/admin/api-docs`로 나뉜다. 이 개수는 명세 충족률이나 모든 경로의 E2E 통과 수를 뜻하지 않는다.

## v0.2 변경 확인

| 요구 | 코드 상태 | 추가 검증 경계 |
| --- | --- | --- |
| 축제 `thumbUrl`, `ticketLinks`와 링크 검증 | 구현 | 실제 크롤 원본별 상세·이미지 저장량 확인 필요 |
| 익명 기기 핀·구독, 소유권 확인 | 기기 access token으로 구현 | 앱 Keychain·재설치 흐름 확인 필요 |
| `termsAcceptedAt`, 약관 버전, `pushOptIn` | 구현 | 실제 계정 마이그레이션·로그인 확인 필요 |
| D-1 18:00 KST `festival.reminder` | 예약·중복 방지 구현 | 실기기 APNs 수신 확인 필요 |
| 당일 창 `days[].startsAt - 6h` ~ `endsAt + 3h` | 서버 데이터 제공 | iOS 첫 화면 선택·오프라인 갱신은 앱 검증 필요 |

## 확인된 계약 차이와 남은 검증

- 원본 PDF의 `DELETE /auth/session`, `/devices/{deviceId}` 및 `/v1` 표기는 후속 사용자 요청에 따라 `POST /auth/logout`, `X-Device-Id`와 기기 access token, `/api/v1`로 변경했다. Google·Apple 모바일 로그인은 `POST /auth/login` 한 경로다.
- 개발 서버의 `GET /api/v1/health`, `GET /api/v1/festivals?limit=1`은 HTTP 200과 `{code,data,message}`를 확인했다. 이 두 응답으로 나머지 96개 HTTP 경로의 실환경 동작을 보증하지 않는다.
- 운영 Railway 배포 `7263f4d4-3295-4bd1-9bfb-1d5b67a6d6b2`는 `main`의 `7faed5e`로 성공했다. 운영의 `/api/v1/health`, `/api/v1/festivals?limit=1`, `/admin/api-docs`는 HTTP 200이었다. 헬스의 DB·Redis는 `up`이지만 운영 축제 목록은 **0건**이다. 크롤 소스별 실행·저장 건수 및 빈 목록의 원인을 확인해야 한다.
- 이미지 버킷 쓰기/읽기, PostgreSQL 실제 쓰기, APNs 실기기, Railway WSS, 앱의 재연결·오프라인 동작은 별도 증거가 필요하다.
- Notion 원문은 연결 계정의 `object_not_found`로 대조하지 못했다. 로컬 PDF와 코드에 근거한 목록이며 Notion과 완전히 일치한다고 주장하지 않는다.

## 남은 동작 차이

PDF의 명시 경로와 현재 컨트롤러를 대조한 결과, 위의 사용자 지정 경로 변경 외에 누락된 HTTP 경로는 찾지 못했다. 다음은 경로가 존재해도 계약 동작이 달라 수정이 필요한 항목이다.

1. 로그아웃은 refresh 토큰만 폐기한다. PDF에는 해당 기기의 푸시 구독 해제가 포함된다. 현재 기기 식별·소유권을 확인한 뒤 해당 기기만 정리해야 한다.
2. 신규 계정의 `nickname`은 최대 12자로 제한하고, 제공된 이름이 없거나 공백뿐이면 임의 코드의 `관객-{4자}`를 발급하도록 로컬 코드를 수정했다. 기본값과 12자 제한 단위 테스트는 통과했고 배포 검증은 남아 있다.
3. 관리자 축제 출처의 `source.verifiedAt`이 7일을 초과하면 초안 조회·수정·발행 응답에 경고를 포함하고 발행은 허용하도록 로컬 코드를 수정했다. 조회의 7일 경계와 발행 허용 단위 테스트는 통과했고 배포 검증은 남아 있다.
4. 개발 Railway의 공개 축제 목록은 공유 캐시 적중 응답에서 `Access-Control-Allow-Origin`이 빠져 AdminWeb 브라우저 요청이 차단될 수 있었다. 목록 응답에 `Vary: Origin, Authorization, X-Device-Id`와 `Cache-Control: private`를 적용했다. 공개 API E2E에서 허용된 Origin의 응답 헤더와 목록 동작은 통과했으며 배포 후 실제 Origin 요청으로 다시 확인해야 한다.

## 수정·증명 계획

- 닉네임은 기존 소셜 이름의 앞뒤 공백을 제거하고 12문자 이하로 제한한다. 비어 있으면 충돌 방지용 임의 4자리 코드로 `관객-{4자}`를 발급한다. 최초 응답과 재로그인 유지 단위/E2E 검증을 추가한다.
- 경고는 `source.verifiedAt`의 유효한 시각이 현재보다 7일을 초과하면 초안 조회·수정과 발행 응답에 포함한다. 게시 자체는 허용하고 7일 경계 테스트를 추가한다.
- 로그아웃은 로그인 Bearer와 함께 제공한 기기 증명으로 해당 기기만 찾은 후 구독·푸시 토큰을 정리한다. 다른 기기나 증명이 없는 호출은 건드리지 않는다. 현재 사용자·기기 토큰의 소유권 경계를 테스트한다.
- 변경마다 대상 Jest 테스트를 먼저 실행하고 `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e`를 통과시킨다. GitHub PR CI와 squash merge 뒤 개발·운영에서 공개 응답을 확인한다. 실기기/APNs와 운영 축제 데이터 수집은 독립 검증으로 남긴다.

이 목록의 라우트 대조와 자동 테스트는 API 작업의 기본 게이트다. AdminWeb 기능 작업은 누락 API 처리와 이 검증 결과를 확정한 뒤 진행한다.
