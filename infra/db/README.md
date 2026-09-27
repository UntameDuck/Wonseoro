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
| 설정 2인 승인 | `config_version` CHECK — 승인자 둘, 서로 다름, 작성자 아님 (D-21) |
| 전형당 활성 설정 1건 | `config_version(cycle_id) WHERE status='ACTIVE'` 부분 유니크 (D-21) |
| 마감정책 수명주기 | `deadline_policy.status` DRAFT→APPROVED→ACTIVATED · 승인 두 명·서로 다름·작성자 아님 · 적용 시각은 ACTIVATED 에만 (D-21 · D-23) |
| 불일치 중복 등록 차단 | `reconciliation_exception(application_id, exception_type) WHERE state IN ('OPEN','MANUAL_REVIEW')` (D-25) |
| 한 전형 한 모집단위 · 취소 후 재지원 허용 | `application(cycle_id, applicant_id, admission_type_id) WHERE status <> 'CANCELLED'` (D-29) |
| 적용 기록은 추가만 | `activation_record` UPDATE·DELETE·TRUNCATE 트리거 차단 (D-35) |
| 연장은 결정 근거와 함께 | `activation_record` CHECK — `EXTEND` 는 `decision_ref`, 연장·되돌리기는 `reason` 필수 (D-35) |

## 엔티티 (v1.0 §6 + v1.1 §02 ERD)

`University` `AdmissionCycle` `AdmissionType` `Department` `Applicant` `Application`
`ApplicationFieldValue` `Document` `DocumentScan` `Payment` `PaymentEvent` `Submission`
`IdempotencyRecord` `ConsentRecord` `AuditEvent` `OutboxEvent` `SyncReceipt`
`DeadlinePolicy` `ConfigVersion` `ActivationRecord` `ReconciliationException`
(`SystemConfig` 는 ERD 에서 뺀다 — D-30)

## 성능

- `AuditEvent` / `OutboxEvent` / `PaymentEvent`는 연도 또는 월 Partition 검토
- DB Connection Pool은 서비스별 Budget + PgBouncer 계열 Pooler (v1.1 §B2)

## 마이그레이션

`migrations/0001_init.sql` — **노션 첨부 `k-admission-postgresql-ddl.txt`가 canonical이다.**
docs/spec-assets/README.md 참조. 별도로 DDL을 새로 쓰지 말 것 (이중 원본 방지).

### 병합 DDL v1.2 — 노션 §02 첨부 교체 후보

`k-admission-postgresql-ddl.v1.2.sql` 은 0001 에 0002·0003·0005·0006 과 0004 의 감사 추가 전용 트리거를
접어 넣은 **새로 까는 스키마**다. 역할·권한(0004)은 환경마다 달라 따로 둔다.
`bash scripts/check-merged-ddl.sh` 가 빈 DB 두 개에 체인과 병합본을 깔아 `pg_dump -s` 를 비교한다 — 같아야 한다.

노션 첨부를 이 파일로 바꾼 뒤: 이 파일을 `0001_init.sql` 로 옮기고, 0002·0003·0005·0006 을 지우고,
0004 는 역할 스크립트로 남긴다. 이미 체인을 적용한 DB 는 스키마가 같으므로 다시 깔 필요가 없다.

`migrations/0002_integrity_constraints.sql` — **임시 파일이다.** (D-21 · D-25 · D-29)
0001 은 노션 첨부와 바이트가 같아야 하므로 테이블을 다시 정의하지 않고
제약만 덧붙인다. 원본은 여전히 노션 하나뿐이고, 이 파일은 "아직 반영되지 않은
차이" 를 한곳에 모아 보여주는 역할이다. 노션 §02 에 접어 넣은 뒤 삭제한다.

⚠️ D-29 는 다른 둘과 성격이 다르다. **제약을 약화**하는 변경이라
(취소된 원서를 자연키에서 제외) 노션 확인이 특히 필요하다.

### 적용

```
docker exec -i wonseoro-dev-postgres-univ-a-1 psql -U wonseoro -d univ_a   -v ON_ERROR_STOP=1 < infra/db/migrations/0002_integrity_constraints.sql
```

### 제약이 실제로 막는지 확인

```
docker exec -i wonseoro-dev-postgres-univ-a-1 psql -U wonseoro -d univ_a   -v ON_ERROR_STOP=1 < infra/db/verify-constraints.sql
```

전부 ROLLBACK 으로 끝난다. 개발 DB 위에서 그대로 돌려도 데이터는 바뀌지 않는다.
