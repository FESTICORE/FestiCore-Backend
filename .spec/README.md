# FestiCore Backend — 스펙 문서

기능/도메인별 명세(Specification)를 이 폴더에 둔다. 구현 전 스펙을 먼저 작성하고,
구현/테스트가 스펙을 충족하는지 검증한다.

## 목록

- [health.md](./health.md) — 헬스체크
- [auth.md](./auth.md) — 소셜 로그인(Google/Apple, provider 분리)

## 작성 규칙

- 파일명: `<도메인>.md` (예: `auth.md`, `festival.md`)
- 각 스펙은 최소한 아래를 포함한다.
  - 개요 / 목적
  - 엔드포인트 (메서드, 경로, 요청, 응답)
  - 성공/실패 응답 형식
  - 검증 기준(테스트로 확인할 항목)
