# Notion API 명세 v0.2 반영 범위

기준: [Notion API 명세서](https://app.notion.com/p/API-400c7b04af13817da9e6e875ae3d47b6) 2026-10-22 v0.2 행과 로컬 `FESTICORE_API명세서_v0.2.pdf` 40쪽. 해당 행은 화면설계서 v1.2의 변경을 요약한다. Notion PDF 업로드가 완료되기 전 로컬 사본을 읽어 요청·응답을 대조했다.

## 확인한 변경

| 영역 | v0.2 요구 | 현행 차이 | 완료 기준 |
| --- | --- | --- | --- |
| 축제 | 목록·상세·팩에 `ticketLinks: {label,url}[]`(0~5개, label 최대 20자)와 `thumbUrl`, 복수 예매처 및 공식 Instagram | 발견 축제의 `sourceUrl` 하나만 주로 노출, 발행 팩에 링크 배열 없음 | 허용된 HTTPS 링크만 중복 없이 반환 |
| 디바이스 구독 | 로그인 없이 축제 핀, `pinned`·`reminders`·`packUpdates`·`pinnedAt`, `pinned:false`는 행 보존 | 기기·구독 API는 JWT 필수, 구독에 핀/리마인더 필드 없음 | 익명 기기와 로그인 기기 모두 자신의 구독만 변경, 다른 기기 조작 차단 |
| 가입 정보 | `termsAcceptedAt`·`termsVersion`·`pushOptIn`·`nicknameConfirmed`, `PATCH /me`의 `acceptTerms:{version}`·`pushOptIn` | 사용자 모델과 PATCH 입력에 없음 | 약관 버전을 기록하고 선택 알림 동의를 구분 |
| 알림 | D-1 18:00 KST `festival.reminder`, 체크리스트와 팩 미수신 안내 | 개최일 시작 알림만 예약 | 시간대·중복·구독 해제·팩 수신 여부 테스트 |
| 당일 창 | 각 `days[].startsAt - 6h`부터 `endsAt + 3h`까지 핀 축제는 앱 첫 화면 S01 | 서버는 Date 헤더를 제공하지만 앱 첫 화면은 서버가 선택하지 않음 | 클라이언트 계약을 문서화하고 날짜 경계를 확인 |
| 오류 | `TERMS_REQUIRED`, `TERMS_VERSION_OUTDATED`, `FESTIVAL_NOT_FOUND` | 새 코드와 사용 위치 없음 | 공통 `{code,data,message}` 및 Swagger 반영 |

## 구현 순서

1. 축제 링크 데이터 모델과 공개 응답 및 검증을 작은 PR로 반영한다.
2. 디바이스 구독의 익명 핀 계약을 확정하고 소유권 보호를 함께 구현한다. PDF의 로그인 불필요는 계정 로그인이 불필요하다는 뜻으로 해석한다. 단순 `X-Device-Id` 값만으로 타인의 구독을 변경하게 해서는 안 된다. 이전 사용자 요청에 따른 헤더 기반 경로와 충돌하는 PDF의 `{deviceId}` 경로는 호환성 경로로만 검토한다.
3. 가입 약관·알림 동의와 오류 응답을 반영한다.
4. D-1 리마인더와 당일 창을 구현하고 예약·시간대 테스트를 통과시킨다.
5. 각 기능별 대상 테스트, lint/build, CI, 스쿼시 머지를 확인한 후 운영 배포를 검증한다.

## 현재 구현과 검증

- 축제 목록·상세·팩의 `thumbUrl`/`ticketLinks`, 발견 축제의 복수 예매처 링크, 관리자 발행 입력 검증을 반영했다.
- 익명 기기는 최초 등록 시 발급된 `deviceAccessToken`으로 소유권을 증명한다. 기기 UUID만으로 기존 기기를 갱신할 수 없다. 구독 변경은 기기별 분당 10회로 제한한다. 다운로드 완료 버전은 현재 발행 버전과 일치할 때만 기록한다.
- 현재 약관 버전은 `2026-10`이며, 계정 쓰기 요청의 약관 확인과 D-1 18:00 KST 리마인더를 반영했다.
- 서버는 인증된 기기의 축제 목록에 `pinned`를 포함하고 응답을 private 캐시로 설정한다. 앱 첫 화면의 ±시간 창 적용은 iOS 클라이언트 구현이 필요하다.

이 문서는 코드 반영 범위를 기록한다. 배포와 실기기 푸시는 별도 검증이 필요하다.
