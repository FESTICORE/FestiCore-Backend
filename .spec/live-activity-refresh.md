# Live Activity 갱신 의도 계약

- 비즈니스 변경으로 발생한 갱신은 같은 DB 트랜잭션에서 `live_activity_refresh_intents`에 기기 ID, 활동 ID, 축제 ID를 기록한다. 롤백된 변경의 의도는 보이지 않는다.
- 비즈니스 갱신 예약 메서드는 `live_activity_deliveries`를 갱신하지 않는다. 기기 행은 `FOR KEY SHARE SKIP LOCKED`로 확인해 APNs의 `FOR NO KEY UPDATE`와 병행하고, 삭제 중인 기기는 건너뛴다. 기기 시작·중지·삭제는 기존 lifecycle 잠금을 따른다.
- materializer는 커밋된 의도의 식별자를 읽은 뒤 기기→의도→delivery 순서로 잠근다. 기기 삭제의 cascade가 의도 행을 지우는 순서와 일치해야 한다. 현재 기기의 활동·축제가 의도와 일치하고 푸시 토큰이 있을 때만 delivery를 pending으로 갱신한다.
- 의도는 해당 delivery 갱신 또는 오래된 의도 폐기와 같은 트랜잭션에서 정확히 삭제한다. 중지·교체된 활동을 다시 활성화하지 않는다.
- delivery의 `lastAttemptAt`은 갱신 의도로 초기화하지 않는다. APNs 재시도 간격과 lease/revision 안전성은 기존 delivery 계약을 따른다.
