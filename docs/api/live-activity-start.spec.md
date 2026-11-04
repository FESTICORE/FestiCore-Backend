# Live Activity 원격 시작 전송 계약

## 대상과 예약

공개 버전이 있는 축제의 첫 행사일 `startsAt`에는 축제를 핀하고 `festivalStarts`를 켠 기기별로 한 건을 예약합니다. 이벤트 키는 `live-activity-start:<festivalId>`입니다. 개인 일정에 공연을 저장한 사용자의 기기는 첫 행사일 시작 예약에서 제외합니다.

로그인한 사용자의 기기에 `liveActivityPushToStartToken`과 APNs 환경이 등록되어 있으면, `user_schedules.setIds`에 저장한 공개 공연 중 가장 이른 시작 시각 **2시간 전**에 Live Activity 시작을 예약합니다. 이 예약은 축제 핀과 `festivalStarts` 구독 설정에 의존하지 않습니다. 이벤트 키 `live-activity-performance:<festivalId>`와 `(deviceId, eventKey)` 유니크 제약으로 여러 저장 공연이나 스케줄러 인스턴스가 같은 기기의 시작 작업을 중복 생성하지 못합니다. 이미 `liveActivityId`가 등록된 기기는 시작하지 않습니다. 일정 저장·삭제 시 미발송 작업을 재예약·취소하고, 공개 공연 시각 변경은 주기 스캔과 전송 직전 재검증에서 반영합니다. 성공 또는 결과 불명의 시작 작업은 자동 재발송하지 않습니다.

전송 직전에도 공개 상태, 사용자 일정, 기기 시작 토큰, 현재 Activity를 다시 조회합니다. 첫 행사일 시작은 핀·구독 설정도 다시 확인합니다. 공연 시작 페이로드의 `nextMine`에는 현재 저장된 다음 공개 공연의 ID·무대·아티스트·시각을 넣고, 계정 식별자는 넣지 않습니다. iOS가 시작 후 별도 업데이트 토큰을 등록하면 기존 Live Activity 갱신 경로에서 개인화된 상태를 전송합니다. 일반 APNs 기기 토큰과 개별 Activity 업데이트 토큰은 원격 시작에 사용하지 않습니다.

## 기기와 사용자 연결

익명 기기를 사용자 일정에 연결할 때 `PUT /api/v1/devices/bind-user`를 호출합니다. `Authorization: Bearer <user access token>`, `X-Device-Id: <UUID v4>`, `X-Device-Access-Token: <현재 익명 deviceAccessToken>`을 함께 보냅니다. 서버는 두 토큰과 저장된 기기 토큰 ID를 확인하고 기기를 사용자에게 연결합니다. 응답 데이터는 `{ deviceId, userId }`입니다. 같은 사용자·기기 토큰으로 요청을 재시도할 수 있습니다. 기존 익명 토큰은 세션 만료 복구 전용 API에서만 쓸 수 있으므로 Keychain에 보존하고, 일반 기기 API는 사용자 Bearer를 사용합니다.

로그아웃 시 앱은 새로운 UUID v4를 `X-Device-Unbind-Key`로 생성해 Keychain에 먼저 저장하고, `DELETE /api/v1/devices/bind-user`에 사용자 Bearer, `X-Device-Id`, 이 키를 함께 보냅니다. 서버는 기존 Live Activity에 개인 정보 없는 종료 상태와 즉시 잠금화면 제거 요청을 APNs로 보내고, Activity·APNs 토큰을 지우며, 미발송 공연·축제 시작 작업을 취소합니다. 기기·구독은 보존하고 새 익명 `deviceAccessToken`을 응답합니다. APNs 종료가 일시 실패하면 연결 해제를 되돌려 재시도할 수 있게 합니다. 응답 데이터는 `{ deviceId, userId: null, deviceAccessToken }`입니다. 응답을 잃거나 토큰 저장에 실패하면 동일한 사용자 Bearer·기기 ID·저장된 키로 재시도할 수 있습니다. 서버는 저장된 키가 일치하는 이미 해제된 기기에만 토큰을 다시 발급하며, 다른 키나 기기 ID만으로는 재발급하지 않습니다. 서버에 Activity 업데이트 토큰이 아직 없는 경우 원격 종료는 불가능하므로 앱도 로그아웃 전 로컬 Activity를 종료해야 합니다. 다른 사용자의 기기나 유효하지 않은 기기 토큰으로는 연결·해제할 수 없습니다.

사용자 Bearer가 만료되어 일반 연결 해제를 호출할 수 없으면 `DELETE /api/v1/devices/bind-user/recover`에 기존 익명 `deviceAccessToken`을 Bearer로, `X-Device-Id`와 사전 저장한 `X-Device-Unbind-Key`를 함께 보냅니다. 서버는 원래 기기 토큰 ID가 일치하는 연결된 기기만 해제하고 미발송 공연 시작 작업을 취소합니다. 이후 기존 토큰은 무효화됩니다. 응답 유실 시 같은 기기 ID와 unbind 키만으로 복구 API를 재시도할 수 있으나, 저장된 새 토큰 ID가 키와 일치하는 이미 해제된 기기에만 응답합니다.

공연 시작 전송 직전에는 사용자의 유효한 refresh 세션이 존재하는지도 확인합니다. 계정 세션이 모두 만료·철회되면 이전 기기 바인딩이 남아 있어도 개인 공연 시작 푸시를 취소합니다.

계정 `POST /api/v1/auth/logout`은 해당 사용자의 남은 기기 푸시 토큰과 알림 설정을 해제하고 미발송 공연 시작 작업을 취소합니다. 이 경로는 기기 바인딩과 핀·팩 기록을 유지하므로, 앱에서 익명 기기 토큰으로 전환하려면 로그아웃 전에 위 연결 해제 API를 호출해야 합니다. 탈퇴는 사용자 소유 기기 자체를 삭제하며 연결된 시작 작업도 외래 키 연쇄 삭제로 정리됩니다.

## 재시도와 결과

APNs 호출 전에 작업을 `failed/OUTCOME_UNKNOWN`으로 내구 기록합니다. APNs 수락 응답은 `sent`로 바꾸고, 명확한 거절 응답은 최대 6회 재시도합니다. 네트워크 타임아웃·응답 불명 또는 전송 중 프로세스 종료는 APNs가 이미 수락했을 가능성이 있으므로 자동 재발송하지 않습니다. 이 정책은 중복 Activity를 막는 대신 결과가 불명확한 단일 전송이 누락될 수 있습니다. 무효 start 토큰은 그 값이 여전히 등록되어 있을 때만 지우며 일반 알림·Activity 업데이트 토큰은 유지합니다.

## 미완료 검증

백엔드 단위 테스트와 CI 통과는 실제 APNs 수신을 증명하지 않습니다. iOS #58의 실기기에서 시작, 새 업데이트 토큰 등록, 갱신 및 종료를 개발 APNs 환경으로 확인한 뒤 #246 완료 여부를 판단합니다.
