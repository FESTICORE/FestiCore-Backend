# Live Activity content-state 계산 계약

## 범위

`buildLiveActivityContentState`는 공개된 축제 공연 세트와 해당 기기에 연결된 인증 계정의 데이터를 입력받아 APNs `aps.content-state`를 계산하는 순수 함수입니다. DB 조회, 기기 토큰 검증, APNs 발송, 재시도와 분당 전송 제한은 `LiveActivityService`와 `ApnsService`가 처리합니다.

## 입력

- `festivalId`: 등록된 Live Activity의 축제 ID. 모든 공연, 깃발, 크루는 이 ID와 일치해야 합니다.
- `now`: 서버가 계산을 시작할 때 정한 유효한 시각. 공연 시각은 타임존이 포함된 ISO 문자열이어야 합니다.
- `festivalStart`, `festivalEnd`: 발행된 `days`의 첫 날짜 서울 00:00과 마지막 날짜 다음날 서울 00:00. 종료 경계는 제외합니다. 유효한 발행 날짜가 없으면 발송을 중단합니다.
- `sets`: 공개된 축제 공연 세트. `startsAt`을 포함하고 `endsAt`을 제외한 구간만 `nowStages`에 들어갑니다. 종료 시각이 없거나 역전된 구간은 현재 공연으로 표시하지 않습니다.
- `member`: 인증 계정이 없으면 `null`. 있으면 본인의 저장한 `setId`, 팔로우한 깃발 ID, 핀 깃발 ID, 현재 크루 정보를 넣습니다. 다른 사용자의 정보를 넣어서는 안 됩니다.
- `flagsEnabled`: 현재 공개 팩의 깃발 기능 스위치. `false`이면 `flags`에 값이 있어도 `pinnedFlag`는 `null`입니다.
- `flags`: 공개·비숨김 깃발만 핀 상태로 내보냅니다. 종료·예약 상태와 팔로우하지 않은 깃발은 제외합니다.

## 출력

| 필드          | 의미                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `phase`       | 축제 시작 전 `upcoming`, 시작 이상 종료 미만 `ongoing`, 종료 이후 `finished`.                                              |
| `startDate`   | 축제 시작 시각을 Swift `JSONEncoder` 기본 `Date` 형식인 2001-01-01 기준 초로 표현합니다.                                  |
| `endDate`     | 축제 종료 시각을 같은 형식으로 표현합니다. iOS의 선택적 날짜 필드이며 발행 일정에는 값이 있습니다.                         |
| `nowStages`   | 현재 진행 중인 공연 최대 8개. 시작 시각, 무대 ID, 세트 ID 순서로 결정합니다.                                               |
| `nextMine`    | 저장된 세트 중 아직 시작하지 않은 가장 이른 공연. 비회원에게는 `null`입니다.                                               |
| `pinnedFlag`  | 현재 축제에서 팔로우하고 핀한 공개 활성 깃발의 최소 상태. 비회원에게는 `null`입니다.                                       |
| `crewSummary` | 현재 축제의 보관되지 않은 크루 이름, 총 인원, `here` 인원과 10분 이내 집결 구역. 개인별 위치와 식별자는 포함하지 않습니다. |
| `leaveAt`     | 현재 `null`. 서버에 신뢰할 수 있는 개인 출발 시각 저장소가 아직 없으므로 추정값을 만들지 않습니다.                         |

반환값은 APNs 페이로드 전체가 아닙니다. 호출 측이 `ApnsService.sendLiveActivityUpdate`에 전달하면 전송부가 `aps.timestamp`, `event`, `stale-date`를 붙입니다. 전송부의 4KB 검사를 통과하지 못한 상태는 발송되지 않습니다.

## 후속 작업

발행 축제의 시작·종료 경계와 행사일 종료 60분 전 갱신은 `LiveActivityService`가 예약합니다. APNs `aps.timestamp`와 `stale-date`는 Unix 기준 초를 유지합니다. 개인 출발 시각 저장과 iOS ActivityKit 표시 검증은 별도로 확인해야 합니다.
