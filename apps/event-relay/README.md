# event-relay — Outbox Relay

담당: 송리안 · 근거: 기술설계서 v1.0 §7.3, v1.1 §04

대학 DB의 `outbox_event`를 중앙 Sync Gateway로 전송한다. **별도 프로세스인 이유는 중앙 장애가 접수 API에 전파되지 않게 하기 위함이다.**

## 규칙

- 전달 보장: At-least-once. 소비자(중앙)가 idempotent해야 한다.
- Ordering Key: `applicationId`. sequence는 Application별 단조 증가.
- 지수 Backoff + Jitter, 최대 재시도 초과 시 Dead Letter.
- 중앙 ACK를 받은 이벤트만 `SENT` 처리.
- **중앙이 장기 장애여도 Outbox는 계속 누적될 수 있어야 한다.** backlog age/size 경보(Prometheus `CentralSyncLagging`·`OutboxDeadEvents` — [경보 대응표](../../docs/14-operations-automation.md#경보-대응표)), PENDING partial index, Partition/Archive로 디스크 고갈 방지 (v1.1 §B7).
- 전송 실패는 절대 접수 실패로 올라가지 않는다.
- CloudEvents 확장 속성 `configversion`·`policyversion` 은 **접수 기록(submission)** 에서 읽는다 — 본문에는 없다(D-50). 접수 전 취소처럼 모르면 싣지 않는다. (D-60)

## 대학 상태 심장박동 (§04 `sync.heartbeat`, D-60)

`RELAY_HEARTBEAT_INTERVAL_MS`(기본 60초)마다 이 대학의 적체(대기 이벤트 수·가장 오래된 대기 시간)·적용 설정 버전·플랫폼 버전(`PLATFORM_VERSION`)·
이 노드의 DB 시계 offset 을 보낸다. 이것이 없으면 중앙은 조용한 대학과 죽은 대학을 구별하지 못한다.

- Outbox 를 거치지 않는다 — "지금" 의 상태라, 중앙이 끊긴 동안 쌓았다가 나중에 보내면 지난 상태가 현재처럼 보인다. 끊겼으면 건너뛴다
- 이벤트 전송과 같은 중앙 회로 차단기를 쓴다
- 중앙은 심장박동이 180초(`HEARTBEAT_STALE_SECONDS`) 끊긴 대학을 "내 원서" 에서 확인 불가로 표시한다
