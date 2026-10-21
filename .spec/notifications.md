# 축제 시작 알림

## 목적

공개된 축제의 각 개최일 `days[].startsAt`에 맞춰 구독 기기에 시작 알림을 보낸다. 수집 단계의 발견 후보나 티켓 판매 시각은 알림 기준으로 사용하지 않는다. 서버 프로세스가 실행 중일 때 예약 작업이 주기적으로 대기 알림을 처리한다.

## 기기 및 구독 API

모든 기기·구독 요청은 `Authorization: Bearer <access JWT>`와 `X-Device-Id` UUID v4 헤더로 인증 사용자 소유의 기기를 선택한다. 기기 비밀값은 발급하거나 요구하지 않는다. 누락되거나 잘못된 JWT는 401, 다른 계정의 기기 ID는 403이다.

- `PUT /api/v1/devices`: 기존 본문에 `apnsEnvironment` (`sandbox` 또는 `production`)를 필수로 추가한다. APNs 토큰의 대상 환경을 서버 배포 환경과 별도로 기록한다.
- `GET /api/v1/notifications/subscriptions`: 현재 기기의 공개 축제 구독 목록을 반환한다. 응답 `data.items[]`는 `festivalId`, `festivalStarts`, `packUpdates`를 포함한다.
- `PUT /api/v1/notifications/subscriptions/{festivalId}`: 본문 `{ "festivalStarts": true, "packUpdates": false }`를 저장한다. `festivalId`는 구독 대상 축제이며 기기 ID가 아니다. 응답 `data`는 저장된 구독이다. `packUpdates`는 구독 설정만 저장하며 팩 변경 푸시 발송은 별도 작업이다.
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
