# 문서 안내

- [아키텍처](./architecture/ARCHITECTURE.md): 코드 구조와 모듈 규칙
- [Railway 배포](./deployment/RAILWAY.md): 환경 변수와 배포 방식
- [API 계약](../.spec/README.md): 구현된 API의 요청·응답·권한·실패·검증 기준
- [서버 크롤링과 관리자 제안](../.spec/crawl.md): 매일 00:00 KST 예약 수집, 이미지 보관, 제안 검토와 발행 경계
- [README](../README.md): 실행과 Swagger 주소

`CLAUDE.md`는 Claude가 저장소 루트에서 읽는 진입점이므로 루트에 두고,
실제 아키텍처 규칙은 `docs/architecture/`에 둔다.
