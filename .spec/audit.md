# 관리자 변경 감사 기록

## GET `/api/v1/admin/audit`

- Bearer JWT와 활성 관리자 `owner` 권한이 필요하다.
- 선택 필터: `actor`(관리자 ID 정확히 일치), `from`, `to`(시간대 포함 ISO8601), `limit`(1~100, 기본 50), `offset`(0~10000, 기본 0).
- `from`과 `to`는 양 끝을 포함한다. 최신순으로 조회한다.
- 응답 `data.items`의 각 항목은 `at`, `actor`, `action`, `target`, `before`, `after`를 담는다. 전역 응답 형식은 `code`, `data`, `message`다.
- 현재 최초 연결 대상은 관리자 깃발 상태 강제 변경이다. 이후 관리자 편집 API는 같은 DB 트랜잭션에서 `AdminAuditService.record`를 호출해야 한다. 기존 편집 이력은 소급 생성되지 않는다.
- 감사 기록에는 비밀번호, 토큰, 쿠키 등 비밀값을 넣지 않는다. 호출자는 필요한 변경 필드만 전달한다.
