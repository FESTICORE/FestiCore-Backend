# 관리자 깃발 상태 강제 변경

기수 기기를 사용할 수 없는 현장에서 관리자가 상태를 대신 갱신한다. API 명세 v0.1 p32의 `POST /admin/flags/{id}/force-status`에 대응한다.

## API

`POST /api/v1/admin/flags/{flagId}/force-status`는 Bearer JWT와 관리자 `editor` 또는 `owner` 권한으로 호출한다. 요청 JSON은 `status`, `zoneId`, `activity`를 모두 보낸다. `active`는 발행된 축제의 존과 `slam|sing|train|calm` 중 하나, `resting`은 존과 `resting`, `scheduled|ended`는 두 값을 `null`로 보낸다. `flagId`와 `updatedAt`은 서버가 정하며 요청 본문에서 받지 않는다.

성공 HTTP 200의 `data`는 `{flagId,status,zoneId,activity,updatedAt}`이고 전체 JSON은 공통 `{code,data,message}` 형식이다. 깃발 또는 존이 없으면 404, 상태 조합이 잘못되면 400, 관리자 권한이 없으면 401/403이다.

변경과 같은 DB 트랜잭션에서 상태 이벤트(`userId=null`)와 `admin_audit`의 변경 전후 상태를 저장한다. 감사 기록 실패 시 상태 변경도 롤백한다. 일반 기수의 상태 전이·분당 제한·멱등키 제한은 관리자 긴급 변경에 적용하지 않는다.

## 검증

- 상태별 필수 필드, 미허용 필드, 발행 축제 존 검증
- 관리자 역할과 세션 확인
- 상태·이벤트·감사 기록에 동일 트랜잭션 매니저를 사용하는지와 감사 실패 전파. 실제 DB 롤백 검증은 배포 전 통합 테스트에서 수행한다.
- Swagger 요청 본문과 공통 응답 형식
