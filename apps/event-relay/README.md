# event-relay — Outbox Relay

담당: 송리안 · 근거: 기술설계서 v1.0 §7.3, v1.1 §04

대학 DB의 `outbox_event`를 중앙 Sync Gateway로 전송한다. **별도 프로세스인 이유는 중앙 장애가 접수 API에 전파되지 않게 하기 위함이다.**

## 규칙

- 전달 보장: At-least-once. 소비자(중앙)가 idempotent해야 한다.
- Ordering Key: `applicationId`. sequence는 Application별 단조 증가.
- 지수 Backoff + Jitter, 최대 재시도 초과 시 Dead Letter.
- 중앙 ACK를 받은 이벤트만 `SENT` 처리.
- **중앙이 장기 장애여도 Outbox는 계속 누적될 수 있어야 한다.** backlog age/size 경보, PENDING partial index, Partition/Archive로 디스크 고갈 방지 (v1.1 §B7).
- 전송 실패는 절대 접수 실패로 올라가지 않는다.
