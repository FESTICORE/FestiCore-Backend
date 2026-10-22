# FestiCore-Backend

페스티코어(FestiCore) 백엔드. NestJS 11 + TypeORM(Postgres), Railway 배포.

## 구성

| 영역          | 내용                                                                             |
| ------------- | -------------------------------------------------------------------------------- |
| common        | 표준 응답/에러 형식, 예외 필터, 로깅·응답 인터셉터, API 도메인 목록              |
| gateway       | 전역 Throttler·JwtAuthGuard(`@Public` 예외)·필터·인터셉터                        |
| swagger       | `/api-docs` 공개 API, `/admin/api-docs` 관리자 API. 각 경로에 도메인별 문서 제공 |
| auth          | Google·Apple 통합 로그인, JWT access/refresh 회전, 회원 탈퇴                     |
| admin         | 일반 로그인 JWT의 관리자 권한 검사, 축제 초안·발행·롤백                           |
| storage       | Railway 비공개 버킷의 WebP 사진 저장·읽기                                        |
| flags         | 공개 깃발, 팔로우·기수·상태·사진·관리자 신고 처리                                |
| devices       | 익명 기기 토큰 등록·소유권 확인·핀·Live Activity 토큰 관리                       |
| notifications | D-1 리마인더·축제 시작 알림 예약·APNs 발송                                       |
| public        | 축제 목록·예매 링크·오프라인 팩과 공개 팩 갱신 WebSocket                          |
| health        | `GET /api/v1/health` — DB 실패 시 503                                            |
| legal         | 공개 홈페이지·개인정보처리방침·이용약관 HTML                                      |

구조와 규칙은 [아키텍처 문서](./docs/architecture/ARCHITECTURE.md), 엔드포인트 계약은 [.spec/](./.spec/README.md),
배포는 [Railway 문서](./docs/deployment/RAILWAY.md)를 본다. 문서 전체 목록은 [docs/](./docs/README.md)에 있다.

API v0.2 변경 내역과 검증 범위는 [v0.2 반영 문서](./.spec/api-v0.2-adoption.md)에 정리했다. 익명 기기는 첫 `PUT /api/v1/devices` 응답의 `deviceAccessToken`을 저장하고 이후 기기 API에 `Authorization: Bearer`와 `X-Device-Id`를 함께 보낸다.

## 로컬 실행

```bash
npm install
# .env 작성(변수 목록은 docs/deployment/RAILWAY.md). 최소: DB_* 와 서로 다른 JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- 공개 페이지: `/api/v1/about`, `/api/v1/legal/privacy`, `/api/v1/legal/terms` ([계약](./.spec/legal-pages.md))
- 공개 팩 갱신 WebSocket: `ws://localhost:3000/api/v1/festivals/updates` ([계약](./.spec/festival-websocket.md))
- 공개 Swagger: `http://localhost:3000/api-docs` (JSON: `/api-docs-json`)
- 관리자 Swagger: `http://localhost:3000/admin/api-docs` (JSON: `/admin/api-docs-json`)
- 개발: [공개](https://festicore-dev.up.railway.app/api-docs) · [관리자](https://festicore-dev.up.railway.app/admin/api-docs)
- 운영: [공개](https://festicore.up.railway.app/api-docs) · [관리자](https://festicore.up.railway.app/admin/api-docs)

각 UI의 드롭다운에서 해당 영역의 전체·도메인별 문서를 선택할 수 있다.
JSON API 응답은 `{ "code": "SUCCESS", "data": ..., "message": "성공적으로 처리되었습니다." }` 형식이며, 오류 코드와 상세 규칙은 [.spec/](./.spec/README.md)에 정리했다.
공개 문서에는 `/api/v1/admin` 경로가 없고, 관리자 문서에는 관리자 경로만 표시된다.
브라우저 호출에는 해당 환경의 유효한 인증 정보가 필요하다. 배포된 문서의 가용성과 최신 코드 반영 여부는 Railway 배포 상태로 확인한다.

## 스크립트

| 명령                         | 설명                           |
| ---------------------------- | ------------------------------ |
| `npm run start:dev`          | 개발 서버(watch)               |
| `npm run build`              | 빌드(`dist/`)                  |
| `npm run lint`               | ESLint                         |
| `npm test`                   | 단위 테스트                    |
| `npm run test:e2e`           | e2e(DB 없이 인메모리 저장소)   |
| `npm run migration:generate` | 마이그레이션 생성(`-- <경로>`) |
| `npm run migration:run`      | 마이그레이션 실행              |

## 브랜치 / 배포

- `develop` → Railway **develop** 환경, `main` → **production** 환경 자동 배포
- 푸시 시 릴리스 태그 자동 생성(`dev-v*` / `v*`)
