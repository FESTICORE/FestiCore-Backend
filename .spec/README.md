# FestiCore Backend — 스펙 문서

기능/도메인별 명세(Specification)를 이 폴더에 둔다. 구현 전 스펙을 먼저 작성하고,
구현/테스트가 스펙을 충족하는지 검증한다.

모든 JSON API 응답의 최상위 필드는 `{ "code": string, "data": unknown | null, "message": string }`이다. 성공 시 `code`는 `SUCCESS`, 오류 시 업무 코드 또는 HTTP 오류 코드다. HTTP 상태는 상태 줄에서 확인한다. 오류 상세(`errors`, `draft`, `retryAfter` 등)는 허용된 값만 `data`에 넣는다. 이미지·HTML·리디렉션과 204·304에는 JSON 본문을 강제하지 않는다.

## 목록

- [api-v0.2-adoption.md](./api-v0.2-adoption.md) — Notion API v0.2 반영 범위와 검증 경계
- [coverage.md](./coverage.md) — 제공된 명세서와 현재 구현의 대조 및 남은 검증
- [health.md](./health.md) — 헬스체크
- [legal.md](./legal.md) — 공개 홈페이지·개인정보처리방침·이용약관 HTML
- [auth.md](./auth.md) — Google/Apple 통합 로그인, 프로필, Apple 웹 콜백
- [me.md](./me.md) — 내 정보 조회·닉네임 변경·회원 탈퇴 요청 본문
- [admin-auth.md](./admin-auth.md) — 일반 로그인과 관리자 권한
- [admin-festivals.md](./admin-festivals.md) — 축제 초안·발행·롤백
- [flags.md](./flags.md) — 깃발·기수·팔로우·사진·신고
- [public-festivals.md](./public-festivals.md) — 발행 축제 목록·팩·깃발·라이브 조회
- [festival-websocket.md](./festival-websocket.md) — 공개 팩 갱신 WebSocket·재연결 계약
- [crews.md](./crews.md) — 비공개 크루·초대·상태·집결·멤버 관리
- [schedule.md](./schedule.md) — 축제별 개인 일정 조회·수정
- [devices.md](./devices.md) — 기기 등록·조회·삭제와 Live Activity 토큰
- [notifications.md](./notifications.md) — 축제 알림 구독·예약·APNs 발송
- [metrics.md](./metrics.md) — 앱 이벤트 수집과 관리자 지표 집계
- [map-upload.md](./map-upload.md) — 관리자 축제 지도 업로드와 공개 WebP 제공
- [force-status.md](./force-status.md) — 관리자 깃발 상태 강제 변경과 감사 기록
- [audit.md](./audit.md) — 관리자 감사 이력 조회
- [crawl.md](./crawl.md) — 관리자 크롤 소스·실행·제안 검토
- [festival-official-profiles.md](./festival-official-profiles.md) — 서울뮤직·원웨이 공식 출연진 사진 수집 계약
- [crawl-catalog.md](./crawl-catalog.md) — 수집된 축제의 공개 목록과 오프라인 갱신 계약
- [festival-discovery.md](./festival-discovery.md) — 판매처별 축제 발견과 원더리벳 수집 기준
- [mintpaper-discovery.md](./mintpaper-discovery.md) — Mint Paper 공식 축제·이미지·계정 수집
- [prugio-official-lineup.md](./prugio-official-lineup.md) — 푸르지오아트홀 공식 날짜별 출연진 수집

## 작성 규칙

- 파일명: `<도메인>.md` (예: `auth.md`, `festival.md`)
- API 모듈 구현과 같은 PR에서 해당 `.spec/<도메인>.md`를 작성·갱신한다.
- 각 스펙은 최소한 아래를 포함한다.
  - 개요 / 목적
  - 엔드포인트 (메서드, 경로, 요청, 응답)
  - 성공/실패 응답 형식
  - 검증 기준(테스트로 확인할 항목)
