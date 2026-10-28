# 팩 WebSocket 수신 계약 (Figma Pack 팩 상세)

## 화면 근거와 범위

- Figma `FESTICORE` 노드 `313:15892`의 팩 상세 화면은 가는 길, 준비물, 팩 관리, 업데이트 받기, 팩 삭제를 보여 준다.
- 공개 팩의 `directions`, `checklist`, `packVersion`, `packUpdatedAt` 및 HTTP 팩·버전 API는 이미 있다. Wi-Fi 사용 여부, 저장 크기, 삭제, 준비물 체크·사용자 추가 항목은 기기의 오프라인 상태로 취급한다. 이 문서는 서버에서 빠진 **WebSocket 팩 수신**을 추가한다.
- 기존 `pack.updated` 알림과 HTTP API는 유지한다. 앱은 연결·전경 복귀·업데이트 버튼에서 저장된 ETag를 사용해 팩을 요청하고 응답을 기기에 원자적으로 저장한다. 연결이 끊기면 마지막 저장 팩을 사용한다.

## 메시지

엔드포인트: `wss://<host>/api/v1/festivals/updates`.

클라이언트 요청: `{"event":"pack.get","data":{"festivalId":"fst_example","ifNoneMatch":"\"cdm3-v12\""},"requestId":"request-1"}`. `requestId`는 필수, `ifNoneMatch`는 선택이다. 서버는 한 소켓에서 한 요청씩 처리하고 응답에 `requestId`를 그대로 넣는다. 앱은 재연결 세대가 다른 소켓의 늦은 응답을 버린다. `packVersion`만으로 변경 없음 여부를 판단하지 않는다. 이미지 권리 상태가 변하면 버전이 그대로여도 ETag가 변할 수 있다.

- 변경됨: `{"event":"pack.snapshot","requestId":"request-1","data":{"festivalId":"fst_example","packVersion":12,"etag":"\"...\"","pack":{...}}}`. `pack`은 `PublicFestivalService.publishedPack()`의 공개 투영 결과만 사용한다.
- 단일 응답이 4 MiB를 넘으면 같은 공개 팩 JSON UTF-8 바이트를 48 KiB씩 나누어 `pack.start`(`requestId`, `festivalId`, `packVersion`, `etag`, `totalBytes`, `chunkCount`, `sha256`), 순서가 있는 `pack.chunk`(`requestId`, `index`, `base64`), `pack.complete`(`requestId`) 순으로 보낸다. 앱은 청크 순서·총 크기·SHA-256을 확인한 후에만 팩과 ETag를 원자적으로 교체한다. 중간 끊김·시간 초과에는 부분 데이터를 버리고 기존 팩을 유지한다.
- 변경 없음: `{"event":"pack.not_modified","requestId":"request-1","data":{"festivalId":"fst_example","packVersion":12,"etag":"\"...\""}}`.
- 재시도 필요: `publishedPack()`으로 공개 투영 후 DB의 최신 발행 버전을 읽는다. DB 팩이 없으면 미공개 오류, 반환 버전과 DB 버전이 다르면 **ETag 비교 전에** `pack.retry`와 목표 버전·재시도 지연을 보낸다. 앱은 저장된 팩을 유지하며 재시도한다. DB 검사 직후 새 발행이 일어나면 기존 `pack.updated` 또는 다음 재연결 조회로 복구한다.
- 오류: 없는/미공개 축제는 `pack.error`의 `FESTIVAL_NOT_FOUND`, 일시적 조회 실패는 `PACK_UNAVAILABLE`; 내부 오류 세부정보는 보내지 않는다. 잘못된 JSON·스키마는 정책 위반으로 연결을 닫는다.
- 공개 팩 JSON이 8 MiB를 넘으면 `pack.error`의 `PACK_TOO_LARGE`를 보낸다. 이 경우 앱은 저장된 팩을 유지하고 기존 HTTP 팩 API를 사용할 수 있다.
- 기존 서버 알림 `pack.updated`는 새 버전 힌트다. 이미지 권리 상태만 바뀌면 버전 알림이 없으므로 앱은 연결·전경 복귀·수동 확인에도 `pack.get`을 보낸다. 알림만으로 업데이트 완료를 표시하지 않고, `pack.snapshot` 저장 후 완료로 처리한다.

## 안전성과 검증

- 수신은 텍스트 JSON 1 KiB 이하, 허용 필드만 사용한다. `requestId` 1–64자, `festivalId` 1–128자의 영문·숫자·밑줄·하이픈, `ifNoneMatch` 128자 이하로 제한한다. 잘못된 형식은 1008, 초과 프레임은 1009로 닫는다.
- 연결당 동시 요청 1개 및 10초당 10회, 프로세스당 동시 팩 처리 32개로 제한한다. 초과 요청에는 `pack.error`의 `PACK_BUSY`와 재시도 지연을 돌려준다. 발신 단일 메시지는 4 MiB 이하이고 큰 팩은 위 청크 프로토콜을 사용한다. 각 청크는 송신 완료 callback을 기다린 후 다음 청크를 보낸다. `bufferedAmount + 다음 메시지 바이트 > 4 MiB`인 느린 연결은 종료한다. 기존 `pack.updated` 브로드캐스트에도 백프레셔 검사를 적용한다. 기존 Origin 및 IP별 연결 제한과 heartbeat를 유지한다.
- 단위/실소켓 테스트: 신규·변경 없음·같은 버전 이미지 ETag 변경·없는 팩·잘못된 JSON/바이너리/초과 프레임·동시 요청/속도 제한·DB보다 오래된/다른 캐시 버전·4 MiB 초과 팩의 청크 재조립·전송 중 단절/백프레셔·기존 브로드캐스트/Origin/heartbeat.
- 검증 명령: 해당 Jest 테스트, `npm test -- --runInBand`, `npm run test:e2e -- --runInBand`, 전체 ESLint, `npx tsc --noEmit --incremental false`, `npm run build`, CI Docker/PostgreSQL 마이그레이션.

## 제한

- 팩의 포스터·출연진 이미지는 URL과 출처 메타데이터로 전달한다. 이미지 바이너리 오프라인 저장은 앱에서 수행한다.
- WebSocket은 연결 중 실시간 수신 경로다. 장시간 오프라인 상태의 갱신은 재연결 시 `pack.get`으로 복구한다.
