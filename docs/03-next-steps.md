# 다음 단계 (Next Steps)

> 최종 갱신: 2026-09-22
> 이 문서는 **"지금 무엇을 해야 하는가"** 하나만 다룬다.
> 전체 계획은 [00-development-plan.md](00-development-plan.md), 단계별 태스크는 [milestones/](milestones/).
> 작업 착수 전 [01-notion-sync-protocol.md](01-notion-sync-protocol.md) 를 먼저 읽는다.

---

## 현재 지점

**139개 태스크 중 27개 완료.** M0·M1 은 사실상 닫혔고 M2 백엔드 절반을 지났다.

| 단계 | 진행 | 비고 |
|---|---|---|
| M0 기반 | 7/8 | 제출문서 정정만 남음 |
| M1 접수 Core | 13/14 | Profile Snapshot 은 central-api 의존으로 M2 와 묶임 |
| **M2 결제·Finalize·화면** | **7/24** | ◀ 현재 |
| M3 운영 안전장치 | 0/15 | |
| M4 분산 실증 | 0/28 | |
| M5 신뢰성·보안·접근성 | 0/35 | |
| M6 Pilot 준비 | 0/15 | |

동작하는 것: 원서 생성 → 자동저장(ETag) → 추가문항 검증 → 서류 업로드·검사 →
결제 의도 → 서버측 재검증 → **Finalize → 접수번호 발급**. 테스트 86개 통과.

아직 없는 것: **중앙(central-api) 전체**, 프론트엔드 전체.

---

## 착수 순서

### 1️⃣ 다음 작업 — event-relay + Sync Gateway (T-M2-07, T-M2-08)

**왜 이것이 먼저인가**: Demo Gate 5 가 이 제품의 차별성이 처음 증명되는 지점이다.
"중앙이 죽어도 대학 접수는 계속된다"를 보여주려면 중앙이 존재해야 한다.
지금은 Outbox 가 `PENDING` 으로 쌓이기만 하고 가져가는 쪽이 없다.

#### T-M2-07 event-relay 전송 루프
- 근거: [v1.1 §04](https://app.notion.com/p/3df75ab5debe81d68e37fabd3678dcc4), v1.0 §7.3
- 위치: `apps/event-relay/`
- 구현
  - `outbox_event` 에서 `PENDING` 을 배치로 집어 중앙에 POST
  - CloudEvents 1.0 envelope + 확장 속성
    (`kadmissionuniversity`, `kadmissionsequence`, `configversion`, `policyversion`, `traceparent`)
  - 지수 Backoff + Jitter, 최대 재시도 초과 시 `DEAD`
  - **중앙 ACK 를 받은 이벤트만 `SENT`** 로 바꾸고 `sync_receipt` 기록
  - backlog age/size 경보 지표 노출 (v1.1 §B7)
- 인수기준
  - 중앙을 내린 채로 접수 → Outbox 누적 → 중앙 복구 → **손실 0으로 전송**
  - 같은 이벤트를 두 번 보내도 중앙 상태가 두 번 바뀌지 않는다
  - **전송 실패가 접수 API 로 절대 전파되지 않는다**

#### T-M2-08 central-api Sync Gateway
- 근거: [v1.1 §04](https://app.notion.com/p/3df75ab5debe81d68e37fabd3678dcc4), [§01 A3](https://app.notion.com/p/3df75ab5debe813c87fceef73f0d74e8)
- 위치: `apps/central-api/src/modules/sync-gateway/`
- OpenAPI 계약: `POST /internal/v1/events`, `GET /internal/v1/events/{eventId}/receipt`, `GET /internal/v1/sync/status`
- 구현
  - dedup key = **`source` + `id`** (§04 명시)
  - `kadmissionsequence` 로 gap 탐지 → `SYNC_LAGGING` / `OUT_OF_ORDER` / `MISSING_SEQUENCE` 경보
  - 중복 수신은 409 + 기존 receipt 반환 (OpenAPI 명시)
  - 중앙 DB 스키마가 필요하다 → **대학 DDL 을 그대로 쓰지 않는다.** 중앙은 요약만 저장한다
- 인수기준
  - 같은 이벤트 100회 수신 → 상태 1회 변경
  - sequence 2 가 1 보다 먼저 와도 gap 으로 탐지된다
  - 중앙 DB 에 이름·연락처·주소·원서본문이 **없다**

> ⚠️ 중앙 DB 스키마는 노션에 canonical DDL 이 없다. 새로 설계해야 하므로
> **먼저 노션 §04·§10 에 중앙 저장 범위를 확정하고 불일치 대장에 등록한 뒤** 만든다.
> 저장소에서 임의로 만들면 D-5 와 같은 문제가 반복된다.

---

### 2️⃣ 그 다음 — Profile Vault + Dashboard (T-M1-09, T-M2-09, T-M2-10)

central-api 가 서면 함께 풀린다.

| 태스크 | 핵심 규칙 |
|---|---|
| T-M1-09 Common Profile Snapshot | 동의한 필드만 복사. **접수완료된 원서는 Profile 변경으로 수정되지 않는다** |
| T-M2-09 Dashboard Summary Store | 화면조회마다 대학 DB 를 호출하지 않는다. State Event 로 갱신된 요약만 읽고 **마지막 동기화 시각을 함께 표시** |
| T-M2-10 Support Self-check | 사용자가 "서버가 아는 상태"를 직접 조회. 장애 시 고객센터 폭주 완화 (§B11) |

---

### 3️⃣ 마지막 — 프론트엔드 13개 (T-M2-20 ~ T-M2-32)

**백엔드 계약이 다 잠긴 뒤에 시작한다.** 지금 시작하면 API 가 바뀔 때마다 헛일이 된다.

순서: KRDS 래퍼 SDK → Step Indicator → 1~6단계 화면 → 자동저장 클라이언트 →
마감 카운트다운 → **장애 UX** → Dashboard

타협 불가 항목 ([§07](https://app.notion.com/p/3df75ab5debe812db3d1e06d0761e38e))
- 마감 표시는 **서버 시간** 기준 (`GET /api/v1/meta/time`). 브라우저 시간 금지
- 자동저장 상태를 항상 텍스트로: `저장 중` / `저장 완료 17:42:13` / `저장 실패 — 다시 시도`
- 오류는 상단 Error Summary + 필드 인접 메시지를 **동시에**
- 중요 결과를 Toast 만으로 알리지 않는다
- 장애 시 처음부터 다시 하라고 요구하지 않는다. 요청번호 + 상태 재조회 버튼
- 중앙 Sync 지연은 접수완료 여부와 **분리 표시**

---

## 기술 채무 (백로그에 안 잡혀 있는 것)

### 🔴 D-7 — 설계 결정 필요, M2 환불 작업 전까지

`CANCELLED` 로 **어느 상태에서 누가** 전이하는지 정의가 없다.
`FINALIZED → CANCELLED` 는 "접수 완료는 되돌릴 수 없다"는 핵심 원칙과 정면으로 부딪힌다.
`kr.kadmission.payment.refunded.v1` 이벤트와 묶여 있으므로 환불을 구현하기 전에 정해야 한다.

**노션에 추가해야 할 것**: 허용 출발 상태 / 권한(사용자·입학처·관리자) / 환불 연계 / FINALIZED 취소 가능 여부

### 노션 반영 대기 5건

저장소는 맞췄으나 노션이 아직 옛 내용이다. 동기화 규칙상 빚이다.

| # | 고칠 곳 |
|---|---|
| D-1 | v1.0 §6.2 예시 JSON → `kr.kadmission.*` |
| D-2 | v1.0 §12.1 정보구조 → 6단계, 제출 PDF 도 |
| D-3 | v1.0 §4 기술 스택 표 Backend 행 |
| D-4 | v1.0 §6.2 예시에 확장 속성 표기 |
| D-12 | §02·§03 에 "원서 생성은 자연키로 멱등" 명시 |

### 설계서 첨부 3/10 배치

| 배치됨 | 남음 (M4/M5 착수 전까지) |
|---|---|
| DDL · OpenAPI · CloudEvents | Helm values-m · runtime · network-rbac · vault policy · KRDS 와이어프레임 · k6 · STRIDE register |

받는 절차는 [02-spec-discrepancy-register.md](02-spec-discrepancy-register.md) D-5 에 있다.

### T-M0-08 제출 PDF 문구 정정

개발보고서의 "Java LTS + Spring Boot" → ADR-0001 의 기술적 동등성 논거를 그대로 쓴다.
심사에서 지적받기 전에 정리해 두는 편이 낫다.

---

## 일정에 대한 현실적 판단

**M4 + M5 가 63개로 전체의 45%** 다. 2인 팀이 대회 일정 안에 여기까지 가기는 어렵다.

| 무엇 | 언제 |
|---|---|
| **대회 심사 목표** | **M2 완성 + M3 일부** (Deadline Policy Engine, Config 2인 승인, Evidence Package) |
| Pilot 계약 트리거 | M4 분산 실증, M5 보안·접근성 |
| 계약 이후 | M6 |

개발보고서도 이렇게 서술되어 있다 — "제품 Core 와 실증 가능한 MVP·표준안을 직접 개발하고,
Pilot 단계부터 대학 입학처·PG사·CSP·보안 전문가와 역할을 분리한다."

M3 에서 **Deadline Policy Engine 과 Config 2인 승인**을 먼저 하는 것을 권한다.
2026년 실제 장애에서 문제가 된 지점이고, 심사에서 가장 설득력 있는 차별점이다.

---

## 착수 전 체크

- [ ] [01-notion-sync-protocol.md](01-notion-sync-protocol.md) 의 "태스크 착수 전 확인" 수행
- [ ] 해당 태스크의 `근거 노션` 절을 다시 읽었는가
- [ ] 마지막으로 읽은 이후 노션이 바뀌었는가
- [ ] 중앙 DB 스키마처럼 **노션에 canonical 이 없는 것**을 새로 만들어야 한다면,
      저장소에 쓰기 전에 노션을 먼저 고치고 대장에 등록했는가
