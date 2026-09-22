# M2 — 결제 · Finalize · 화면 (MVP 완성)

| | |
|---|---|
| **목표** | 지원자가 화면에서 결제하고 접수번호를 받는다. **중앙이 죽어 있어도 된다.** |
| **완료 기준** | Demo Gate 1~5 전부 통과 |
| **선행 조건** | M1 종료 체크리스트 완료 |
| **주 담당** | 송리안 (Payment·Finalize·Relay) / 권민준 (Frontend 6단계·Dashboard) |

> **이번 개발 사이클의 1차 목표가 이 단계다.** 여기까지가 "동작 데모".

## Demo Gate (= 완료 판정)

```
1. 가입 → 공통원서 작성 → A대 원서 생성 → 자동저장 3회 이상 기록
2. 서류 1건 업로드 → AVAILABLE 전이
3. Sandbox 결제 → 서버측 재검증 → 자동 Finalize → 접수번호 화면 표시
4. 동일 Idempotency-Key로 Finalize 100회 → Submission 1건
5. central-api를 내린 상태로 1~4 전체 재수행 → 정상 접수완료
   → central-api 복구 후 Dashboard에 자동 반영
```

**5번이 이 제품의 차별성이 처음으로 증명되는 지점이다.** 데모 시연 순서에서 하이라이트로 잡는다.

## 노션 확인 대상

| 문서 | 이 단계에서 보는 이유 |
|---|---|
| [v1.0 §5.5·§5.6](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | Payment Adapter 인터페이스, Finalize 9단계 |
| [02. ERD](https://app.notion.com/p/3df75ab5debe81299f7cffbd769811ee) | Finalize Transaction 8단계 순서 |
| [04. CloudEvents](https://app.notion.com/p/3df75ab5debe81d68e37fabd3678dcc4) | 이벤트 타입·확장 속성·dedup·순서 |
| [07. KRDS 와이어프레임](https://app.notion.com/p/3df75ab5debe812db3d1e06d0761e38e) | 6단계 화면, 장애 UX, 접근성 |
| [01. 운영 리스크](https://app.notion.com/p/3df75ab5debe813c87fceef73f0d74e8) | A4(결제/접수 분리) · B4(Callback 유실) · A3(Eventual Consistency) |
| [10. 트래픽 분산](https://app.notion.com/p/3df75ab5debe8143b651d8aef608a0a5) | §12 접수 Critical Path, §9 Dashboard, §13 장애 시 처리 |

## 진행 현황 (2026-09-22)

| 구분 | 태스크 |
|---|---|
| ✅ 완료 | 백엔드 11개 + T-M1-09 + **프론트 11개** (20~24·27~32) |
| 🔜 남음 | T-M2-25 서류 업로드 화면 · T-M2-26 검토·결제 화면 보강 (골격만) |
| 🔜 프론트 | T-M2-20~32 (전체) |

### ⭐ §A5 를 UI 까지 증명 (2026-09-23)

**프론트 코드를 한 줄도 고치지 않고 새 전형 화면이 나왔다.**

```
1. DB Config 에만 REGULAR 전형 추가 (admission_type 1행 + config_json.forms.REGULAR)
2. 새로고침 → 화면이 바뀐다

   1단계  이메일                        ← REGULAR 스키마에 contactEmail 만 있어서
   3단계  수능 수험번호*  (0/8자)        ← title·description·maxLength 모두 스키마에서
          희망 세부전공*  (0/60자)
          (양식 버전 cfg-2027-v2)

   기존 EARLY 전형은 영향 없음
```

화면은 `GET /api/v1/applications/{id}/form-schema` 하나만 본다.
필드명·라벨·글자수 제한·필수 여부·숫자 변환까지 전부 스키마에서 읽는다.
**필드명이 코드에 남아 있지 않다.**

### 🖥️ 화면에서 End-to-End 확인 (2026-09-23)

실제 브라우저에서 6단계를 끝까지 돌렸다.

```
공통원서 Snapshot 자동 반영  → 출신고등학교 "원서로고등학교" (7/100자)
1 공통정보 → 2 대학·전형 → 3 추가정보(자기소개 입력)
→ 4 서류 → [검토 단계로] 자동저장 + /validate 통과 → 5 검토·결제
→ [전형료 결제] 결제+서버측 재검증 → 6 최종제출
→ [최종 제출] → 접수번호 2027-UNIV-A-GLC4CZ25QS
```

- 마감 카운트다운이 **서버 시각 기준**으로 표시된다 (브라우저 시계 미사용)
- 저장 상태가 항상 텍스트로 보인다 — `✓ 저장 완료 0시 32분 53초`
- Step Indicator 가 색만이 아니라 `(현재 단계)` `(완료)` 를 스크린리더에 전달한다
- 중앙을 내린 뒤 Dashboard 진입 → **"통합 조회를 일시적으로 사용할 수 없습니다"**
  "이미 접수하신 원서는 영향을 받지 않습니다" 를 함께 보여준다.
  **조회 실패를 접수 실패처럼 보이게 하지 않는다** — 그래야 중복 제출을 막는다

### 🎯 Demo Gate 5 통과 — 이 제품의 핵심 주장이 증명된 지점

```
중앙(central-api) 정지 상태에서
  원서 생성 → 자동저장 → 결제 → 재검증 → Finalize  → 201  2027-UNIV-A-CV7PST4HPC
  대학 DB: submission 2건 / outbox PENDING 2건
  relay:   ECONNREFUSED 로 지수 Backoff 재시도 (접수 API 에 영향 0)

중앙 기동 후
  relay 자동 재전송  → outbox pending=0, dead=0
  중앙:  received_event 2건 / application_summary 2건 / sync_gap OPEN 0건
  Dashboard: 접수번호 + 마지막 동기화 시각 표시
  중앙 테이블 컬럼: 이름·연락처·주소·원서본문 **없음**
```

**중앙이 죽어 있는 동안에도 접수번호가 발급됐고, 복구 후 손실 0으로 반영됐다.**

**Demo Gate 3·4 통과.** 결제 → 서버측 재검증 → Finalize → 접수번호 발급이 실제 DB 위에서 동작한다.

```
결제 전 Finalize            → 409 PAYMENT_NOT_CONFIRMED
결제 의도 생성              → 201 (금액은 대학 설정에서, 클라이언트가 보내지 않는다)
서버측 재검증               → 200 CONFIRMED
Finalize                    → 201  2027-UNIV-A-4ZCPKYQ9T6
동일 Idempotency-Key 20회    → 전부 200 (재시도), Submission 1건
다른 키로 재시도             → 200 (기존 접수 반환)
```

DB 확인: `submission 1건 / application FINALIZED / outbox 1건 seq=1 PENDING / audit APPLICATION_FINALIZED 1건`

Outbox 가 `PENDING` 으로 남아 있는 것이 정상이다. 중앙 전송은 event-relay 가 맡는다.
**중앙이 없어도 접수는 이미 완료된 상태다.**

### 구현 중 잡은 버그 3건

| 버그 | 원인 | 영향 |
|---|---|---|
| 결제 의도 생성 500 | 트랜잭션 **안**에서 풀의 다른 커넥션으로 읽어 커밋 전 INSERT 를 못 봄 | 결제 시작 자체가 불가 |
| Finalize 500 | 개발용 마감정책 버전 문자열이 DDL `varchar(64)` 초과 | 접수 전면 실패 |
| 재시도가 201 반환 | 응답 재생 시 저장된 상태코드를 복원하지 않음 | OpenAPI 계약 위반 (200=재시도, 201=신규) |

세 번째는 데이터는 멀쩡한데 **계약만 어긋난** 경우다. 클라이언트가 재시도를 신규 접수로
오해하면 "두 번 접수됐다"는 문의가 발생한다.

## 태스크

### 백엔드 (송리안)

| ID | 태스크 | 근거 노션 | 인수기준 | 상태 |
|---|---|---|---|---|
| T-M2-01 | PG Adapter 인터페이스 + Mock Provider | v1.0 §5.5 | 5개 메서드 구현, 실 PG는 교체만으로 가능 | ✅ |
| T-M2-02 | 서버측 결제 재검증 | v1.0 §5.5 | 클라이언트 성공값 무시, 서버가 PG 재조회 | ✅ |
| T-M2-03 | Payment 상태머신 (UNKNOWN 포함) | §01 A4·B4 | Callback + Polling 이중 확인 | ✅ |
| T-M2-04 | **Finalize 트랜잭션** | §02, v1.0 §5.6 | 8단계 순서 준수, 외부 호출 0 | ✅ |
| T-M2-05 | 접수번호 발급 | v1.0 §5.6 | 추측 불가 (§09 BOLA) | ✅ |
| T-M2-06 | Outbox INSERT (동일 트랜잭션) | v1.0 §7.3 | aggregate_sequence 단조 증가 | ✅ |
| T-M2-07 | event-relay 전송 루프 | §04, v1.0 §7.3 | 지수 Backoff+Jitter, ACK 후 SENT, Dead Letter | ✅ |
| T-M2-08 | central-api Sync Gateway | §04, §01 A3 | `source+id` dedup, sequence gap 탐지 | ✅ |
| T-M2-09 | Dashboard Summary Store | §10 §9 | 대학 DB 실시간 조회 금지, 마지막 동기화 시각 표시 | ✅ |
| T-M2-10 | Support Self-check API | §01 C7 | 사용자가 서버가 아는 상태를 직접 조회 | ✅ |
| T-M2-11 | 접수증 조회 | §03 | 제출시각·전형·모집단위·상태 | ✅ |

### 프론트엔드 (권민준)

| ID | 태스크 | 근거 노션 | 인수기준 | 상태 |
|---|---|---|---|---|
| T-M2-20 | KRDS 토큰·컴포넌트 래퍼 SDK | §07, §01 B15 | 대학 브랜딩은 허용 theme token만 | ✅ |
| T-M2-21 | Step Indicator + Breadcrumb (6단계) | §07 | D-2 채택안 준수 | ✅ |
| T-M2-22 | 1. 공통정보 화면 | §07 | Label≠Placeholder, 수집목적 명시 | ✅ |
| T-M2-23 | 2. 대학·전형 화면 | §07 | 전형 변경 시 서류·전형료 변화 즉시 안내 | ✅ |
| T-M2-24 | 3. 추가정보 (동적 폼 렌더러) | §07, §01 A5 | JSON Schema로 렌더, 글자수·필수여부 표시 | ✅ |
| T-M2-25 | 4. 서류 업로드 | §07 | 업로드/검사 상태 텍스트 제공, Drag&Drop 단독 금지 | ⬜ |
| T-M2-26 | 5. 검토·결제 | §07 | 누락항목·금액·결제상태를 한 화면에 | 🟡 골격만 |
| T-M2-27 | 6. 최종제출 | §07 | 서버시각·마감·결제검증상태·수정제한을 버튼 직전에 | ✅ |
| T-M2-28 | 완료 화면 | §07 | 접수번호·제출시각, 중앙 Sync 지연 분리 표시 | ✅ |
| T-M2-29 | 자동저장 클라이언트 | §10 §4 | Debounce 15초, PATCH+ETag, 동일값 억제, 재연결 재전송 | ✅ |
| T-M2-30 | 마감 카운트다운 (서버시간) | §01 A2 | 브라우저 시간 미사용, 30·10·5·1분 경고 | ✅ |
| T-M2-31 | **장애 UX** | §07 | 마지막 저장시각·서버 확인 상태·요청번호·재조회 버튼 | ✅ |
| T-M2-32 | 내 원서 Dashboard | §10 §9 | 요약상태 + 마지막 동기화 시각 | ✅ |

## 태스크 상세

### T-M2-04 — Finalize 트랜잭션 ⭐ 이 저장소에서 가장 중요한 코드

**순서 (§02 — 이 순서를 바꾸지 않는다)**
```
1. Idempotency record 확인/잠금
2. Application 상태·버전·마감정책 확인
3. 사전 검증된 Payment snapshot 확인    ← PG 재조회는 이 단계 이전에 끝나 있어야 함
4. Submission INSERT
5. Application → FINALIZED 조건부 전이
6. Outbox Event INSERT
7. Audit Event INSERT
8. Commit
```

**트랜잭션 밖에서 처리**: PG 조회 · PDF 생성 · SMS · 메일 · 중앙 전송

**금지 사항**
- 트랜잭션 안에서 외부 HTTP 호출 (락 유지 시간이 외부 지연에 묶인다 — §01 B3)
- 중앙 전송 성공을 접수 성공 조건으로 삼기
- Finalize 실패 시 Payment를 되돌리기 (별도 Aggregate다 — §01 A4)

**검증**: DB Failover 중에도 중복 Submission 0. M4에서 실측하지만, 구조는 여기서 확정된다.

### T-M2-03 — Payment UNKNOWN 상태

PG Callback은 유실되거나 30분 늦게 온다 (§01 B4). 이때 상태를 FAILED로 떨어뜨리면 **돈은 나갔는데 접수는 안 된 상태**가 된다.

```
Callback 수신 → 서버가 PG에 재조회 → CONFIRMED
Callback 미수신 → Polling → CONFIRMED
둘 다 실패 → UNKNOWN (FAILED 아님) → Reconciliation 큐로
```

사용자에게는 "결제 확인 중"으로 보여주고 재결제를 유도하지 않는다. 중복 결제가 더 큰 사고다.

### T-M2-07 — event-relay

- At-least-once. 중앙이 idempotent해야 한다 (dedup key = `source` + `id`)
- Ordering Key = `applicationId`, sequence는 Application별 단조 증가
- 지수 Backoff + Jitter, 최대 재시도 초과 시 Dead Letter
- **중앙 ACK를 받은 이벤트만 SENT 처리**
- 중앙 장기 장애에도 Outbox가 계속 누적 가능해야 한다 — backlog age/size 경보 (§01 B7)
- **전송 실패가 접수 API로 절대 전파되지 않는다**

### T-M2-31 — 장애 UX (§07)

경쟁 서비스와 갈리는 지점이다. 장애 시:
- 마지막 저장시각과 **현재 서버가 확인한 상태**를 보여준다
- 처음부터 다시 하라고 요구하지 않는다
- 요청번호 + 상태 재조회 버튼을 제공해 중복 제출을 막는다
- 중앙 Sync 지연은 접수완료 여부와 **분리해서** 표시한다
  ("접수 완료 / 중앙 동기화 지연 중"은 접수 실패가 아니다)

## 종료 체크리스트

- [ ] Demo Gate 1~5 전부 통과 (5번 포함 — central-api 내린 채로)
- [ ] Finalize 트랜잭션 안에 외부 호출이 하나도 없는지 코드 검토
- [ ] 동일 Idempotency-Key 100회 → Submission 1건
- [ ] PG Callback 30분 지연 시뮬레이션 → UNKNOWN → 자동 정합화
- [ ] 키보드만으로 1~6단계 전체 통과 (M5 접근성 인증 전 사전 점검)
- [ ] **노션 §04·§07을 다시 읽고**, 구현하며 바뀐 이벤트 필드·화면 흐름을 노션에 반영
- [ ] 이벤트에 필드를 추가했다면 optional인지 확인하고 §04 Schema Evolution 규칙대로 노션 갱신
- [ ] 발견한 불일치를 D-N으로 등록·처리
- [ ] 데모 시연 시나리오 문서화 (`docs/runbook/demo-script.md`)
