# 깃발·기수 API

## 목적과 권한

발행된 축제의 공개 깃발을 조회하고, 로그인 사용자가 팔로우·핀·신고한다.
기수는 등록 코드로 소유권을 증명한 뒤 사진·프로필·현장 상태를 관리한다.
관리자 요청에는 Bearer JWT와 활성 관리자 역할이 필요하다.

## 앱 API

| 메서드 | 경로 | 인증 | 요청과 결과 |
| --- | --- | --- | --- |
| GET | `/api/v1/flags/:flagId` | 선택 | 공개 프로필·상태, 로그인 시 팔로우/기수 여부 |
| GET | `/api/v1/flags/:flagId/photo` | 없음 | 공개 WebP 사진 |
| GET | `/api/v1/flags/:flagId/thumbnail` | 없음 | 공개 WebP 썸네일 |
| PUT | `/api/v1/flags/:flagId/follow` | 앱 JWT | `Idempotency-Key` 필수, 팔로우 |
| DELETE | `/api/v1/flags/:flagId/follow` | 앱 JWT | 팔로우 해제 |
| POST | `/api/v1/flags/:flagId/report` | 앱 JWT | 신고 사유·메모, 202 |
| GET | `/api/v1/flags/:flagId/bearer` | 기수 | 기수 전용 상태, `no-store` |
| PATCH | `/api/v1/flags/:flagId` | 기수 | 프로필 수정 |
| POST | `/api/v1/flags/:flagId/status` | 기수 | `Idempotency-Key` 필수, 현장 상태 변경 |
| POST | `/api/v1/flags/:flagId/photo` | 기수 | multipart `photo`(JPEG/PNG/HEIC/HEIF, 최대 5MB), WebP 변환·저장 |
| POST | `/api/v1/flags/:flagId/co-bearers/invite` | 소유 기수 | 공동 기수 초대 |
| DELETE | `/api/v1/flags/:flagId/co-bearers/:userId` | 소유 기수 | 공동 기수 해제, 204 |
| POST | `/api/v1/bearer/claim` | 앱 JWT | 등록 코드·`X-Device-Id`로 기수 권한 신청 |
| GET | `/api/v1/me/follows` | 앱 JWT | 내 팔로우 목록, 선택 `festivalId` |
| PUT | `/api/v1/me/pinned-flag` | 앱 JWT | 내 대표 깃발 지정 |

### 상태 변경의 오래됨 판단

- `POST /flags/:flagId/status`는 `clientAt`이 마지막으로 반영한 기수 변경의 `clientAt`(`flags."statusClientAt"`)보다
  이르면 409 `STATUS_STALE`이다. 서버 처리 시각(`statusUpdatedAt`)과 비교하지 않으므로, 오프라인에서 쌓인 변경을
  누른 순서대로 보내면 모두 반영된다. 다른 기기가 더 나중에 누른 변경이 먼저 반영됐으면 이전 변경은 막힌다.
- 저장하는 `statusClientAt`은 서버 시각을 넘지 않는다. 최대 5분까지 허용한 미래 `clientAt`은 서버 시각으로 잘라
  다른 기수의 정상 변경이 막히지 않게 한다. `clientAt`이 기준값과 같으면 오래된 변경으로 보지 않는다.
- 관리자 강제 변경은 서버 시계 기준 처리 시각을 `statusClientAt`으로 저장해 그 전에 누른 기수 변경을 막는다.
  기존 기준값보다 낮추지는 않는다.
- 마지막으로 반영한 변경과 같은 `clientAt`으로 같은 상태를 보내면(새 멱등키의 재전송) 쓰기·이벤트·알림·분당 한도
  없이 현재 상태를 200으로 돌려준다.
- 열이 없던 이전 깃발(`statusClientAt` null)은 첫 변경을 오래됨 검사 없이 받는다.

### 기수 상태의 마지막 변경자

- `GET /flags/:flagId/bearer`의 `status`와 `POST /flags/:flagId/status` 응답은
  `updatedBy: { userId, nickname } | null`을 포함한다. 공동 기수를 포함해 마지막으로 상태를 바꾼
  기수다. 관리자 강제 변경 뒤와 아직 바뀐 적 없는 깃발은 `null`이다. 변경한 기수가 탈퇴하면 `null`로 바꾼다.
  닉네임을 찾지 못하면 `""`다. 컬럼 추가 전에 바뀐 깃발은 마이그레이션 `1792500099000`이 최신 상태 이력의
  사용자로 채운다. 그 이력이 관리자 변경이거나 탈퇴로 지워졌으면 `null`로 둔다.
- 공개 상세(`GET /flags/:flagId`)와 라이브 보드의 상태에는 넣지 않는다.
- 기수 코드 등록 422 `BEARER_CODE_INVALID`는 `data.remainingAttempts`, 423 `BEARER_CODE_LOCKED`는
  `data.retryAfter`(초)를 준다.

## 관리자 API

| 메서드 | 경로 | 최소 역할 | 결과 |
| --- | --- | --- | --- |
| POST | `/api/v1/admin/festivals/:festivalId/bearer-codes` | editor | 등록 코드 생성, 관리자 행위 감사 기록 |
| GET | `/api/v1/admin/festivals/:festivalId/bearer-codes` | viewer | 코드 현황 |
| GET | `/api/v1/admin/festivals/:festivalId/flags` | viewer | 깃발 현황 |
| GET | `/api/v1/admin/flags/reported` | viewer | 신고된 깃발 |
| POST | `/api/v1/admin/flags/:flagId/hide` | editor | 공개 숨김, 변경 전후 감사 기록 |
| POST | `/api/v1/admin/flags/:flagId/unhide` | editor | 숨김 해제, 변경 전후 감사 기록 |

## 실패·보안·검증

- 비공개 또는 숨김 깃발의 공개 조회와 사진은 404다. 기수 전용 쓰기는 소유권을 확인한다.
- 등록 코드는 조회용 해시와 암호문으로 저장한다. 관리자 코드 목록의 원문 복원에
  서버의 refresh 비밀값에서 분리해 파생한 키를 사용한다. 코드 추측은 사용자·디바이스·IP별로 제한한다.
- 등록 코드 원문을 반환하는 관리자 응답은 `Cache-Control: no-store`다. JWT refresh 비밀값을
  교체하면 이전 암호문을 복원할 수 없으므로, 기존 코드를 폐기하고 다시 발급해야 한다.
- 코드 발급과 숨김 변경은 감사 기록을 같은 DB 트랜잭션에 저장한다. 감사 기록에는 코드 수,
  라벨, 만료 시각만 남기며 코드 원문·해시·암호문은 남기지 않는다. 숨김 변경과 공개 깃발 팩
  갱신도 같은 트랜잭션에서 처리한다. 코드 발급 응답은 `Cache-Control: no-store`다.
- 팔로우·상태의 동일 멱등키에 다른 요청을 보내면 409다. 키는 24시간 보관한다.
- 사진은 실제 바이트를 디코딩한 뒤 EXIF를 제거하고 WebP로 재인코딩한다.
- 상태 변경의 `clientAt` 오래됨/미래 시간 검증과 소유권은
  `src/modules/flags/flag-rules.spec.ts`, `flag-claim-throttle.service.spec.ts` 및
  PR CI에서 확인한다. 엔드포인트 전체 e2e는 후속 검증 대상으로 남는다.
