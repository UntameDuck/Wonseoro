# M1 — 접수 Core

| | |
|---|---|
| **목표** | 원서를 만들고, 자동저장하고, 서류를 붙이고, 검증을 통과시키는 것까지 **API 레벨에서** 끝낸다 |
| **완료 기준** | 원서 생성 → 자동저장 → 서류 AVAILABLE → `/validate` 통과가 curl만으로 재현된다 |
| **선행 조건** | **T-M0-06 (첨부 8종 배치) 완료** — DDL·OpenAPI 없이 시작하면 안 된다 |
| **주 담당** | 송리안 (Core) / 권민준 (계약 리뷰·Compose·CI) |

## 노션 확인 대상

| 문서 | 이 단계에서 보는 이유 |
|---|---|
| [02. PostgreSQL ERD](https://app.notion.com/p/3df75ab5debe81299f7cffbd769811ee) | 엔티티·정합성 규칙·Finalize 트랜잭션 순서 |
| [03. OpenAPI 계약](https://app.notion.com/p/3df75ab5debe81588b56fcd81e7b3856) | 엔드포인트·공통 요구(Idempotency/ETag/problem+json) |
| [01. 운영 리스크](https://app.notion.com/p/3df75ab5debe813c87fceef73f0d74e8) | A2(마감) · A4(상태 분리) · B2(Connection Storm) · B3(Lock 경합) · B12(중복 요청) |
| [v1.0 §5.3·§5.4·§9](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | Application/Document Service, 감사 이벤트 |
| [10. 트래픽 분산](https://app.notion.com/p/3df75ab5debe8143b651d8aef608a0a5) | 자동저장 구현 규칙(§4), 공통원서 Snapshot(§3) |

## 태스크

| ID | 태스크 | 담당 | 근거 노션 | 인수기준 |
|---|---|---|---|---|
| T-M1-01 | DDL 적용 + 마이그레이션 러너 | 송리안 | §02 + 첨부 DDL | 20개 엔티티 생성, 정합성 제약 5종 확인 |
| T-M1-02 | NestJS 부트스트랩으로 교체 | 송리안 | ADR-0001 | 헬스체크 유지한 채 Nest 모듈 구조 전환 |
| T-M1-03 | 공통 에러 모델 `problem+json` | 송리안 | §03, v1.0 §5.2 | 모든 오류가 ProblemDetails로 나감 |
| T-M1-04 | Idempotency 미들웨어 | 송리안 | §01 B12, §02 | 키 없는 mutation 400, 재사용 시 원응답 반환 |
| T-M1-05 | Application 상태머신 | 송리안 | v1.0 §5.6, §02 | 허용 외 전이 거부, 조건부 UPDATE |
| T-M1-06 | Draft PATCH + ETag/If-Match | 송리안 | §03, §10 §4 | 버전 불일치 시 409 |
| T-M1-07 | `GET /meta/time` | 송리안 | §01 A2 | serverTime·deadlineAt·policyVersion 동시 반환 |
| T-M1-08 | 마감 검증 (서버시간 기준) | 송리안 | §01 A2 | 브라우저 시간 미사용, 경계값 테스트 |
| T-M1-09 | Common Profile Snapshot 복사 | 공동 | §10 §3 | 원서 생성 시 동의 필드만 복사 |
| T-M1-10 | 동적 추가문항 Schema Registry | 송리안 | §01 A5 | 대학 차이를 JSON Schema로 흡수, code fork 0 |
| T-M1-11 | Document Service 업로드 파이프라인 | 송리안 | v1.0 §5.4, §01 B5 | Presigned → QUARANTINED → AVAILABLE |
| T-M1-12 | Audit Event 기록 (hash-chain 준비) | 송리안 | v1.0 §9, §01 A11 | 상태 변경마다 감사 레코드 |
| T-M1-13 | DB Connection Pool 예산 | 권민준 | §01 B2 | 서비스별 pool 상한 고정 |
| T-M1-14 | 계약 테스트 (OpenAPI ↔ 구현) | 권민준 | §03 | CI에서 계약 이탈 검출 |

## 태스크 상세

### T-M1-01 — DDL 적용

**목표**: 노션 첨부 DDL을 `infra/db/migrations/0001_init.sql`로 배치하고 실제로 적용한다.

**인수 확인 (DB에 직접 질의해서 확인할 것)**
```sql
-- 아래가 전부 존재해야 한다
submission.application_id                      UNIQUE
outbox_event(aggregate_id, aggregate_sequence) UNIQUE
payment(provider, provider_tx_id)              UNIQUE
application.version                            BIGINT NOT NULL
outbox_event(status) WHERE status = 'PENDING'  partial index
```

**노션 확인 포인트**: 첨부 DDL에 위 제약이 없으면 **노션 §02 본문이 요구하는 규칙과 첨부가 어긋난 것**이다. D-N으로 등록하고 첨부를 고친 뒤 배치한다. 저장소에서만 몰래 추가하지 않는다.

### T-M1-04 — Idempotency 미들웨어

**목표**: 모든 mutation에서 중복 요청이 상태를 두 번 바꾸지 못하게 한다.

**동작**
- `Idempotency-Key` 헤더 없는 POST/PATCH/DELETE → 400 `idempotency-key-required`
- 같은 키 + 같은 요청 바디 → 최초 응답을 그대로 재생
- 같은 키 + 다른 바디 → 409 `idempotency-key-reused`
- 레코드는 DB에 두고 Finalize 트랜잭션에서 **선차단**에 쓴다 (§01 B3)

**검증**: 동일 키 100회 동시 요청 → 상태 변경 1회. 이 테스트를 M1에서 만들어두면 M2 Demo Gate 4번이 그대로 통과한다.

### T-M1-05 — Application 상태머신

`packages/contracts/src/application-state.ts`의 `APPLICATION_TRANSITIONS`를 **단일 출처로** 사용한다. 서비스 코드에 전이 조건을 중복해서 쓰지 않는다.

DB 반영은 조건부 UPDATE로 한다 — `WHERE status = :expected AND version = :version`. 읽고-검사하고-쓰는 방식은 경합에서 깨진다 (§01 B3).

### T-M1-08 — 마감 검증

**M1 범위**: 서버시간 기준 검증까지. 서명된 DeadlinePolicy 엔진 전체는 M3다.
단, **지금부터 마감 시각을 코드 상수로 박지 않는다.** `deadline` 모듈이 정책 객체를 읽는 형태로 만들어야 M3에서 정책 엔진만 갈아끼울 수 있다.

**경계값 테스트**: 마감 ±5초, 서버 clock offset이 허용범위를 넘은 경우 (§01 A9).

### T-M1-09 — Common Profile Snapshot

`central-api`의 Profile Vault → `admission-api`가 **동의한 필드만** 복사한다.

핵심 규칙 (§10 §3):
- Common Profile은 재사용 원본, University Application은 해당 접수용 Snapshot
- 이미 접수완료된 원서는 Profile 변경으로 수정되지 않는다
- 미접수 원서에만 사용자가 선택적으로 Sync

### T-M1-11 — Document Service

```
upload-intent 발급 → 브라우저가 Object Storage로 직접 업로드 → complete 호출
  → Hash·magic-byte·MIME·확장자·크기 서버측 재검증
  → QUARANTINED → (AV 검사) → AVAILABLE
```

**M1에서 AV는 Mock**이지만 상태 전이는 실제로 구현한다. 접수 확정 시 필수서류 판정은 **AVAILABLE 기준**이어야 하므로 상태가 없으면 M2가 막힌다.
브라우저가 보낸 MIME은 신뢰하지 않는다. magic-byte로 판정한다.

## 종료 체크리스트

- [ ] 14개 태스크 전부 완료
- [ ] curl만으로 "원서 생성 → 자동저장 → 서류 AVAILABLE → validate 통과" 재현
- [ ] 동일 Idempotency-Key 100회 → 상태 변경 1회 테스트 통과
- [ ] 마감 경계값(±5초) 테스트 통과
- [ ] **노션 §02·§03을 다시 읽고**, 구현하며 바뀐 부분을 노션에 반영
- [ ] 이 단계에서 발견한 불일치를 D-N으로 대장에 등록하고 처리
- [ ] `packages/contracts` 변경분을 두 사람이 공동 리뷰
