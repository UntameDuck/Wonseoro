# 데이터베이스

## 원칙 (기술설계서 v1.1 §02)

- 대학 Data Plane의 PostgreSQL이 **해당 대학 접수의 System of Record**다.
- 중앙 집계 DB는 원본 판정에 사용하지 않는다.
- 대학마다 DB를 분리한다. 여러 대학을 한 DB에 합치지 않는다. (완전 대리운영에서도 동일)

## 반드시 DB 제약으로 강제할 정합성 규칙

| 규칙 | 구현 |
|---|---|
| 성공 Submission은 Application당 최대 1건 | `submission.application_id` UNIQUE |
| Outbox 중복·순서 검증 | `outbox_event(aggregate_id, aggregate_sequence)` UNIQUE |
| PG 거래 재사용 방지 | `payment(provider, provider_tx_id)` UNIQUE |
| 낙관적 동시성 | `application.version` BIGINT + 조건부 UPDATE |
| Outbox 조회 성능 | `outbox_event(status) WHERE status='PENDING'` partial index |
| Finalized 불변 | 일반 사용자 API에 업무필드 UPDATE 경로를 만들지 않음 |
| PII 분리 | PII 컬럼을 일반 업무필드와 분리, 중앙 기본 이벤트에 미포함 |

## 엔티티 (v1.0 §6 + v1.1 §02 ERD)

`University` `AdmissionCycle` `AdmissionType` `Department` `Applicant` `Application`
`ApplicationFieldValue` `Document` `DocumentScan` `Payment` `PaymentEvent` `Submission`
`IdempotencyRecord` `ConsentRecord` `AuditEvent` `OutboxEvent` `SyncReceipt`
`DeadlinePolicy` `ConfigVersion` `SystemConfig`

## 성능

- `AuditEvent` / `OutboxEvent` / `PaymentEvent`는 연도 또는 월 Partition 검토
- DB Connection Pool은 서비스별 Budget + PgBouncer 계열 Pooler (v1.1 §B2)

## 마이그레이션

`migrations/0001_init.sql` — **노션 첨부 `k-admission-postgresql-ddl.txt`가 canonical이다.**
docs/spec-assets/README.md 참조. 별도로 DDL을 새로 쓰지 말 것 (이중 원본 방지).
