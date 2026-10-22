# 축제 관리 API

## 목적과 권한

관리자 전용 축제 초안을 수정하고 발행 버전을 보존한다. 조회는 Bearer JWT와 활성 관리자 권한이 필요하다.
생성·수정·발행은 `editor` 이상, 롤백은 `owner`가 필요하다.

## 엔드포인트

기본 경로: `/api/v1/admin/festivals`.

| 메서드 | 경로                     | 입력                                                                    | 결과                                                              |
| ------ | ------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| GET    | `/`                      | 없음                                                                    | 축제 목록, 초안/발행 버전, 열린 크롤 제안 수                      |
| POST   | `/`                      | `{ name, venue, days }`                                                 | 기본 필드를 채운 초안(`draftVersion=1`)                           |
| GET    | `/:id/draft`             | ID                                                                      | 현재 초안·버전                                                    |
| PATCH  | `/:id/draft`             | `If-Match: "d{draftVersion}"`, JSON 병합 패치                           | 검증된 새 초안·버전                                               |
| PUT    | `/:id/draft/sets`        | 같은 `If-Match`, 배열                                                   | 공연 목록 전체 교체                                               |
| PUT    | `/:id/draft/zones`       | 같은 `If-Match`, 배열                                                   | 존 목록 전체 교체                                                 |
| GET    | `/:id/draft/diff`        | ID                                                                      | 발행본 대비 최상위 필드 차이                                      |
| POST   | `/:id/publish`           | `If-Match: "d{draftVersion}"`, `{ note?: string }`                     | 검토한 초안 버전만 발행. 새 `packVersion`, ETag, `pushedDevices`(알림 대기열 등록 수) |
| GET    | `/:id/versions`          | ID                                                                      | 발행 이력                                                         |
| POST   | `/:id/rollback`          | `{ toVersion }`                                                         | 이전 팩을 새 버전으로 재발행                                      |
| POST   | `/:id/pack/import-image` | multipart `image` (JPEG/PNG/WebP, 최대 10MB), `date` (등록된 축제 날짜) | HTTP 200 `{ draft: Set[], confidence: 0..1, unparsed: string[] }` |

공연 `Set`의 선택 필드 `imageUrl`에는 서버가 보관한 `/api/v1/festivals/images/{imageId}.webp` 경로만 넣는다. 외부 URL은 거부한다. 발행 후 공개 상세의 `sets`와 `timetable`에 이 경로가 전달되며, 사진이 없는 공연은 `imageUrl: null`이다. `timetable`의 각 항목에는 `date`와 `stageName`도 포함된다. 공연별 공식 시작·종료 시각이 없으면 공연을 임의 생성하지 않는다.

## 실패와 보안

- 대상이 없으면 404, 초안 값이 유효하지 않으면 400이다.
- 수정 `If-Match`가 없거나 잘못되면 428, 버전이 바뀌었으면 412와 최신 초안을 반환한다.
- 위험한 중첩 JSON 키(`__proto__`, `constructor`, `prototype`)는 거부한다.
- 발행 팩은 Brotli 압축 기준 200KB 이하이다. 발행·롤백 시 구독 기기의 `pack.updated` 알림을 대기열에 등록하고 별도 작업자가 APNs로 전송한다.
- 생성·초안 수정(공연/존 배열 교체 포함)·발행·롤백은 변경 전후 상태와 관리자 ID를 `admin_audit`에 같은 DB 트랜잭션으로 기록한다. 감사 기록에 실패하면 변경도 취소한다. 발행·롤백 감사 기록에는 팩 전체 대신 버전과 메모/대상 버전만 담는다.
- 이미지 입력은 Tesseract 한국어·영어 OCR을 사용한다. 무대명·시작/종료 시각·아티스트가 같은 OCR 행에서 명확한 경우만 기존 무대 ID와 축제 시간 범위에 맞춰 `draft`에 담는다. 불확실하거나 범위를 벗어나는 행은 `unparsed`에 보존한다. 초안·발행본을 저장하거나 변경하지 않으며 관리자가 결과를 검토하고 `PUT /:id/draft/sets`로 저장한다.
- 업로드는 픽셀 수·가로세로 길이를 제한하고, OCR 하위 프로세스는 고정 인자·15초 시간 제한을 사용한다. OCR 실행 실패 시 503을 반환한다.

## 검증

`src/modules/admin/festival/*.spec.ts`에서 입력 검증·동시 수정·권한·발행·롤백을 확인한다.
