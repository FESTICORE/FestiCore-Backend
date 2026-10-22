# 미사용 테이블 정리 (#71)

현재 관리자 로그인은 `admin_accounts`와 앱 JWT를 사용하고, 관리자 감사 기록은 `admin_audit`에 저장한다. `admin_auth_audit`는 과거 로그인 방식의 엔티티 선언과 생성 마이그레이션에만 남아 있다.

- 개발·운영 DB에서 `admin_auth_audit`의 정확한 행 수는 각각 0건으로 확인했다.
- 운영 DB에서 이 테이블을 참조하는 외래키는 0개다.
- 운영 중인 백엔드 커밋 `7faed5e`와 현재 소스 모두 이 테이블에 읽기·쓰기를 하지 않는다.
- `RemoveUnusedAdminAuthAudit1792500035000`은 적용 시 행이 한 건이라도 있으면 실패하고, 비어 있을 때만 테이블을 삭제한다. `down`은 빈 테이블과 인덱스를 복원한다.
- 과거 생성 마이그레이션은 변경하지 않는다. `admin_audit`, `admin_notifications`와 다른 빈 테이블은 유지한다.

검증: TypeScript·ESLint·빌드 및 Docker/Postgres 마이그레이션 CI. 실제 DB 삭제는 새 코드가 해당 환경에 배포될 때 실행된다.
