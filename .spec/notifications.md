# 축제 시작 알림

## D-1 축제 리마인더 (v0.2)

- 발행 팩의 첫 `days[].date` 전날 18:00 Asia/Seoul(09:00 UTC)에 축제당 기기별 작업 하나를 예약한다. `eventKey`는 `festival-reminder:{festivalId}`이며 `(deviceId, eventKey)` 유일 제약으로 중복 예약을 막는다. 첫 개최일이 바뀌면 미발송 작업만 새 시각으로 옮긴다.
- 발송 직전 `pinned=true`, `reminders=true`, 공개 팩, APNs 토큰을 다시 확인한다. 핀 해제, 알림 끄기, 구독 삭제, 기기 삭제 시 작업을 취소한다.
- 핀을 해제한 동안에는 시작 알림도 예약·발송하지 않는다. `festivalStarts` 선호값은 보존하며 다시 핀하면 적용한다.
- `festival.reminder`는 준비물 확인 문구와 발행 팩 체크리스트 항목 최대 3개의 요약을 담은 소리 있는 alert다. `packDownloadedVersion`이 현재 `publishedVersion`과 다르면 `지금 팩을 받아 두세요.`를 덧붙이고 S00 경로 `/`를 보낸다. 같으면 S12 준비물 경로 `/festivals/{festivalId}/checklist`를 보낸다. `packUpdates`는 팩 업데이트 푸시 동의이므로 팩 다운로드 판정에 사용하지 않는다.
- APNs 수락은 실제 단말 표시의 증거가 아니다. 앱은 `eventKey`로 중복 표시를 방지한다.

## 목적

공개된 축제의 각 개최일 `days[].startsAt`에 맞춰 구독 기기에 시작 알림을 보낸다. 수집 단계의 발견 후보나 티켓 판매 시각은 알림 기준으로 사용하지 않는다. 서버 프로세스가 실행 중일 때 예약 작업이 주기적으로 대기 알림을 처리한다.

## 기기 및 구독 API

첫 `PUT /api/v1/devices`는 Bearer 없이 가능하며, 응답의 `deviceAccessToken`을 앱 Keychain에 저장한다. 이후 기기·구독 요청은 `Authorization: Bearer <deviceAccessToken>`과 `X-Device-Id` UUID v4 헤더로 소유권을 증명한다. 로그인 계정이 소유한 기기는 계정 access JWT를 사용한다. 기존 기기를 UUID만으로 갱신할 수 없고, 기기 비밀값 헤더는 요구하지 않는다. 누락·잘못된 토큰은 401, 다른 계정의 기기는 403이다.

- `PUT /api/v1/devices`: 본문에 `apnsEnvironment` (`sandbox` 또는 `production`)가 필수다. 익명 기기는 최초 등록·갱신 시 `deviceAccessToken`을 받으며 갱신 전 토큰도 만료 전까지 유효하다. 토큰 노출 시에는 기존 소유자 인증으로 기기를 삭제하고 새 UUID로 등록한다.
- `GET /api/v1/notifications/subscriptions`: 응답 `data.items[]`는 `festivalId`, `pinned`, `pinnedAt`, `reminders`, `festivalStarts`, `packUpdates`를 포함한다.
- `PUT /api/v1/notifications/subscriptions/{festivalId}`: 본문 `{ "pinned": true, "reminders": true, "packUpdates": false }`를 저장한다. `pinned`는 필수이고 false여도 구독 행을 보존한다. 새 핀은 `reminders`와 `festivalStarts`가 기본 true, `packUpdates`는 기본 false다. 기존 구독에서 생략한 알림 설정은 유지한다. 기기별 분당 10회로 제한한다.
- `PUT /api/v1/notifications/subscriptions/{festivalId}/pack-download`: 본문 `{ "packVersion": 1 }`은 현재 발행 버전과 일치할 때만 다운로드 완료를 기록한다. 성공 204.
- `DELETE /api/v1/notifications/subscriptions/{festivalId}`: 해당 기기의 구독을 해제한다. 성공 204.
- `POST /api/v1/admin/push/test`: Bearer JWT와 `editor` 이상 관리자 권한으로 `{ "deviceId": "UUID v4", "type": "flag.status|crew.status|crew.gather|pack.updated" }`를 보내면 등록된 한 기기의 APNs 토큰과 환경으로 테스트 푸시 1건을 시도한다. 자유 입력 메시지와 APNs 토큰은 받지 않는다. 분당 5회로 제한하고 감사 기록에 요청을 남긴다. 응답 `data`는 `deviceId`, `type`, APNs 수락 여부 `accepted`, 실패 시 `reason`이다. APNs 수락은 실기기 수신을 보장하지 않는다.

JSON 응답은 공통 `{ "code", "data", "message" }` 형식을 따른다. 204에는 본문이 없다. 비밀값·APNs 토큰은 목록 응답에 넣지 않는다.

## 예약·발송 규칙

- 발행된 축제 팩의 날짜와 시작 시각만 기준으로 예약한다. 시작 시각이 바뀌면 미발송 작업의 시간을 갱신한다.
- `(deviceId, eventKey)`를 유일하게 저장한다. `eventKey`는 `festival-start:{festivalId}:{YYYY-MM-DD}`다.
- 여러 서버 인스턴스에서 같은 작업을 중복 선점하지 않도록 DB 잠금과 임대 시간을 사용한다. 매 주기 최대 100건을 동시성 10으로 처리하며 시작 2시간 이내의 작업을 발송한다. 실패 작업은 제한된 횟수로 재시도한다.
- 발송 직전에 현재 구독, 기기 토큰, 발행된 시작 시각을 다시 확인한다. 구독 해제·기기 삭제·회원 탈퇴 후에는 보내지 않는다.
- APNs는 기기별 `apnsEnvironment`에 따라 개발/운영 엔드포인트를 선택한다. 자격증명이 없으면 시작 시 명확히 로깅하고 발송을 시도하지 않는다.
- APNs 수락 직후 서버 장애가 나면 재시도 중복이 생길 수 있다. 앱은 `eventKey` 기반으로 알림을 중복 표시하지 않도록 처리한다.

## 검증

구독 소유권, 헤더 누락/위조, 비공개 축제, 중복 예약, 다중 인스턴스 선점, 구독 해제 경쟁, APNs 성공/일시 실패/무효 토큰, KST 날짜 경계와 서버 재시작을 테스트한다. 실제 iOS 수신은 APNs 자격증명과 실기기 토큰으로 별도 확인한다.
