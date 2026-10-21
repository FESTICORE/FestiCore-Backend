# 관리자 권한 API

## 인증과 권한

관리자도 일반 사용자와 동일한 `POST /api/v1/auth/login`으로 Google 로그인하고,
발급받은 Bearer access JWT로 `/api/v1/admin/*`를 호출한다. 관리자 전용 로그인,
매직 링크, 세션 쿠키는 사용하지 않는다. Apple 로그인 사용자는 관리자 권한을
자동으로 얻지 않는다.

서버는 JWT의 사용자 ID와 연결된 활성 관리자 계정을 매 요청마다 조회한다.
역할은 `viewer < editor < owner`이며 JWT 안의 역할이나 요청 본문의 역할을
권한 근거로 사용하지 않는다. 관리자 쓰기 요청은 허용된 웹 Origin을 확인한다.
관리자 계정의 고유 ID는 감사 기록의 행위자 ID로 유지한다.

## 엔드포인트

| 메서드 | 경로 | 입력 | 결과/권한 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | 기존 Google 로그인 요청 | 일반 access/refresh JWT 발급. 관리 권한이 없어도 로그인 가능 |
| GET | `/api/v1/me` | Bearer access JWT | 일반 사용자 정보와 `admin: null | { id, role }` |
| POST | `/api/v1/auth/logout` | 기존 로그아웃 요청 | refresh 토큰 폐기 |
| GET | `/api/v1/admin/admins` | Bearer access JWT | `owner` 전용 관리자 계정 목록 |
| POST | `/api/v1/admin/admins/invite` | Bearer access JWT, `{ "email": "editor@example.com", "role": "editor" }` | `owner` 전용 권한 부여 또는 재활성화. `{ id, email, userId, role, active, createdAt }` |
| DELETE | `/api/v1/admin/admins/{id}` | Bearer access JWT, UUID 계정 ID | `owner` 전용 권한 비활성화, 204 |

## 계정 연결과 회수

- 권한 부여 대상의 이메일은 Google 로그인에서 확인된 이메일과 일치할 때만
  사용자 ID에 연결한다. 기존 `User.email` 또는 Apple 계정의 이메일만으로 연결하지 않는다.
- `ADMIN_OWNER_EMAIL`은 최초 owner 권한의 대기 이메일이다. 해당 이메일의
  Google 인증이 확인된 뒤 연결한다. 기존 관리자 계정 중 사용자 ID가 없는 행은
  연결 전까지 관리자 API를 호출할 수 없다.
- 권한 회수와 역할 변경은 다음 관리자 요청에 적용된다. 자기 계정과 마지막
  활성 owner는 비활성화할 수 없다. 비활성화와 재활성화는 이전 사용자 ID 연결을
  지우므로 새로 확인된 Google 로그인 뒤에 다시 연결된다. 마지막 owner는 회원
  탈퇴도 할 수 없다.
- 일반 로그아웃은 refresh 토큰을 폐기한다. 이미 발급된 access JWT는 만료까지
  유효하므로, 즉시 관리자 접근을 차단하려면 관리자 권한을 비활성화해야 한다.
- 관리자 권한 부여·연결·회수·관리자 탈퇴는 감사 기록과 같은 트랜잭션으로 저장한다.

## 검증

JWT 부재·일반 사용자·역할 부족, 같은 JWT의 권한 부여·회수, 확인되지 않은
Google 이메일, Apple 이메일 일치, 이전 관리자 쿠키 단독 요청, 마지막 owner
회수·탈퇴, 변경 요청의 Origin을 테스트한다.
