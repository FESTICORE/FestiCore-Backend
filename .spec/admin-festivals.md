# 축제 관리 API

## 목적과 권한

관리자 전용 축제 초안을 수정하고 발행 버전을 보존한다. 조회는 관리자 세션이 필요하다.
생성·수정·발행은 `editor` 이상, 롤백은 `owner`가 필요하다.

## 엔드포인트

기본 경로: `/api/v1/admin/festivals`.

| 메서드 | 경로 | 입력 | 결과 |
| --- | --- | --- | --- |
| GET | `/` | 없음 | 축제 목록, 초안/발행 버전, 열린 크롤 제안 수 |
| POST | `/` | `{ name, venue, days }` | 기본 필드를 채운 초안(`draftVersion=1`) |
| GET | `/:id/draft` | ID | 현재 초안·버전 |
| PATCH | `/:id/draft` | `If-Match: "d{draftVersion}"`, JSON 병합 패치 | 검증된 새 초안·버전 |
| PUT | `/:id/draft/sets` | 같은 `If-Match`, 배열 | 공연 목록 전체 교체 |
| PUT | `/:id/draft/zones` | 같은 `If-Match`, 배열 | 존 목록 전체 교체 |
| GET | `/:id/draft/diff` | ID | 발행본 대비 최상위 필드 차이 |
| POST | `/:id/publish` | `{ note?: string }` | 새 `packVersion`, ETag, `pushedDevices: 0` |
| GET | `/:id/versions` | ID | 발행 이력 |
| POST | `/:id/rollback` | `{ toVersion }` | 이전 팩을 새 버전으로 재발행 |

## 실패와 보안

- 대상이 없으면 404, 초안 값이 유효하지 않으면 400이다.
- 수정 `If-Match`가 없거나 잘못되면 428, 버전이 바뀌었으면 412와 최신 초안을 반환한다.
- 위험한 중첩 JSON 키(`__proto__`, `constructor`, `prototype`)는 거부한다.
- 발행 팩은 Brotli 압축 기준 200KB 이하이며, 발행은 푸시 전송을 아직 수행하지 않는다.

## 검증

`src/modules/admin/festival/*.spec.ts`에서 입력 검증·동시 수정·권한·발행·롤백을 확인한다.
