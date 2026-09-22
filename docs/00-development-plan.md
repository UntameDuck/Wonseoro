# 원서로(K-Admission) 개발 플랜 v1

> 작성 기준일: 2026-09-22
> 근거 문서: `04_[개발보고서]_GovTech_창업경진대회_21stARK(제출본)`, Notion `K-Admission 기술설계서 v1.0` / `v1.1 (01~10)`
> 이 문서는 **설계서를 실행 가능한 개발 계획으로 번역한 것**이다. 아키텍처 원칙은 설계서가 상위 문서이고, 구현 순서·범위·일정은 이 문서가 상위 문서다.
>
> ⚠️ **작업 전 필독**: [01-notion-sync-protocol.md](01-notion-sync-protocol.md)
> 노션 설계서는 살아 있는 문서다. 태스크 착수 전·완료 시·마일스톤 종료 시 **반드시 노션을 다시 읽고 반영한다.**
> 세부 태스크는 이 문서가 아니라 [`milestones/`](milestones/) 아래 단계별 문서에 있다.

---

## 0. 출발점

| 항목 | 현재 상태 |
|---|---|
| 코드 | 없음 (그린필드) |
| GitHub `UntameDuck/Wonseoro` | 빈 저장소, 커밋 0건 |
| 설계 산출물 | 아키텍처·ERD·OpenAPI 목록·CloudEvents·보안정책·테스트 시나리오까지 문서로 존재 |
| 로컬 환경 | Node 25.7 / npm 11.10 / Docker 29.2 / kubectl 1.34 / git 2.55 / gh 2.89 |

**문제 정의**: 설계 밀도는 이미 상용 SI 수준인데 실행 코드가 0이다. 따라서 이번 사이클의 리스크는 "무엇을 만들지 모른다"가 아니라 **"설계서 전부를 동시에 만들려다 아무것도 안 돌아간다"** 이다.
→ 플랜의 제1원칙: **Critical Path를 먼저 끝까지 뚫고, 그 다음에 설계서의 안전장치를 하나씩 채운다.**

---

## 1. 확정된 기술 결정

| # | 결정 | 내용 | 근거 |
|---|---|---|---|
| ADR-0001 | 백엔드 | **NestJS + TypeScript** (Java/Spring 아님) | 팀 역량이 Node/TS에 집중. 설계서의 "Java LTS"는 *동등 기능의 LTS 런타임*으로 문구 조정 필요 |
| ADR-0002 | 저장소 | **단일 저장소 + 내부 강분리** (npm workspaces) | FE/BE 개발은 분리하되 API 계약은 한 곳에서 공유 |
| ADR-0003 | MVP 범위 | 단일 대학 End-to-End 접수 1건 성공 | 데모 가능성이 최우선 |
| — | DB | PostgreSQL 16 + Prisma (마이그레이션은 SQL 우선) | 설계서 `02. ERD` 준수, Outbox/Idempotency는 raw SQL 제어 |
| — | 프론트 | Next.js(App Router) + TypeScript + KRDS 토큰 | 설계서 `12. KRDS UI/UX` |
| — | 패키지 매니저 | **npm workspaces** (pnpm 미설치) | 추가 설치 없이 즉시 동작 |
| — | 이벤트 네임스페이스 | `kr.kadmission.*` | v1.1 §04가 canonical (v1.0 §6.2 예시와 다름) |
| — | 지원자 흐름 | **6단계** | v1.1 §07이 canonical (PDF 5단계 / v1.0 §12.1 10항목과 다름) |
| — | 로컬 인프라 | Docker Compose (postgres / redis / minio) | K-PaaS는 M4에서 도입 |

> **Java → NestJS 변경은 "스펙 이탈"이 아니라 "스펙 문구 수정 대상"이다.**
> 설계서가 실제로 요구하는 것은 언어가 아니라 ① ACID 트랜잭션 ② Outbox ③ 관측성 ④ 장기지원 런타임이다. Node 22/24 LTS + PostgreSQL 조합은 네 가지를 모두 만족한다. 심사·조달 문서에서 "Java LTS"로 적힌 부분은 제출 전에 한 번 정정해야 한다. (→ 액션 T-0)

---

## 2. 저장소 전략 — 분리에 대한 판단

요청하신 "백엔드/프론트 분리"에 대한 결론부터:

> **개발·배포·CI는 분리한다. 저장소는 분리하지 않는다.**

### 왜 분리해야 하는가 (분리 찬성 근거)
- 2인 팀의 역할이 이미 완전히 갈라져 있다 (송리안 = 접수 Core/DB/보안, 권민준 = Applicant Web/편의계층).
- 배포 단위가 실제로 다르다. University Data Plane은 대학별 K-PaaS에, Applicant Web은 중앙 Edge에 올라간다.
- 릴리스 주기가 다르다. 접수기간에 Data Plane은 Freeze인데 프론트 문구 수정은 나갈 수 있어야 한다.

### 왜 저장소까지 쪼개면 안 되는가 (분리 반대 근거)
- 이 프로젝트의 핵심 자산은 코드가 아니라 **API 계약(OpenAPI) + Event Schema + 상태머신 정의**다. 저장소를 쪼개면 이게 즉시 두 벌이 되고, 2인 팀에서 계약 드리프트를 잡을 사람이 없다.
- 설계서 `A16 표준 버전 Breaking Change` / `A5 대학별 커스터마이징으로 표준 붕괴`가 정확히 이 위험을 지적하고 있다.
- 저장소 2개 = PR 2개 = 리뷰 2배. 마감이 있는 2인 팀에는 순손실.

### 채택 구조 — "모노레포 안의 분리"

```
dev-folder/                        ← git repo root (UntameDuck/Wonseoro)
├── apps/                          ← 배포 단위. 이름은 기술설계서 §5 / §13.1 서비스명을 따른다
│   ├── admission-api/             ← [송리안] 대학 Data Plane 메인 API (System of Record)
│   ├── document-service/          ← [송리안] 서류 — Presigned Upload · 재검증 · AV 상태
│   ├── event-relay/               ← [송리안] Outbox → 중앙 Sync (별도 프로세스)
│   ├── central-api/               ← [공동] 중앙 Control + Convenience Plane
│   ├── frontend/                  ← [권민준] 지원자 웹 (Next.js + KRDS, 6단계)
│   └── admin-web/                 ← (M3) 입학처 관리자 콘솔
├── packages/
│   └── contracts/                 ← [공동] OpenAPI · CloudEvents · 상태머신 · 감사 스키마
├── deploy/                        ← GitOps 저장소 구조 (v1.1 §05를 그대로 따름)
│   ├── charts/k-admission/        ← Chart.yaml, values.yaml, values-s/m/l.yaml, templates/
│   ├── platform/                  ← namespaces · policies · observability · admission-controller
│   ├── universities/UNIV-A/       ← values.yaml · config-ref.yaml · policy-ref.yaml
│   └── schemas/
├── infra/
│   ├── compose/                   ← 로컬 개발 스택 (대학별 DB 분리 유지)
│   └── db/                        ← DDL · 마이그레이션
├── tests/load/                    ← k6 부하·장애·복구 시나리오 (M4)
├── docs/                          ← 플랜 · ADR · 런북 · 설계서 첨부 배치표
└── .github/workflows/             ← 앱별 독립 CI 잡
```

분리 효과는 **경계로** 확보한다:
- `apps/*`는 서로를 직접 import 할 수 없다. 반드시 `packages/contracts`를 경유한다.
- CI는 변경 경로별로 잡을 나눈다 (`paths:` 필터). 프론트 수정이 백엔드 테스트를 돌리지 않는다.
- Dockerfile·Helm 차트는 앱마다 독립. 배포는 이미 완전히 분리되어 있다.
- 접수기간 Freeze도 앱 단위로 건다 (`admission-api`만 freeze).

> **분리를 저장소 수준으로 올리는 시점**: 대학 Pilot이 3곳을 넘고, Data Plane이 외부 기관(대학 정보화부서)에 코드째 인계되어야 할 때. 그 전에는 이득이 없다.

---

## 3. 시스템 분해 — 설계서 3-Plane → 실제 배포 단위

| Plane | 배포 단위 | 책임 | 장애 시 |
|---|---|---|---|
| Convenience | `central-api` + `frontend` | 통합 로그인, Common Profile Vault, 대학/전형 Catalog, 내 원서 Dashboard, 경쟁률 Snapshot | 죽어도 **대학 접수는 계속된다** |
| Control | `central-api` (별도 모듈/별도 배포) | Schema/Config/Release Registry, GitOps, 관제 | 죽어도 기존 Runtime 정상 |
| University Data | `admission-api` + `document-service` + `event-relay` (대학별 N세트) | Draft 자동저장, 추가문항, 서류, 결제검증, **Finalize**, 접수번호, 원본 감사로그 | 해당 대학만 영향 |

**절대 규칙 (코드 리뷰 체크리스트에 그대로 들어감)**
1. `admission-api`의 Finalize 트랜잭션은 `central-api`를 호출하지 않는다.
2. 중앙 전송 실패는 사용자 접수 실패가 아니다. (Outbox에 남기고 200 반환)
3. 대학 DB만 System of Record다. 중앙 조회 결과로 접수 여부를 판정하지 않는다.
4. 마감 판정은 **서버 시간 + 서명된 DeadlinePolicy 버전**으로만 한다. 브라우저 시간 금지, 코드 상수 금지.

---

## 4. MVP 범위 정의

목표: **"한 명의 지원자가 한 대학에 원서를 넣고 접수번호를 받는다"를 화면에서 끝까지 시연**

### In Scope (M1~M2)
- [ ] 지원자 로그인 (자체 세션, 본인확인은 Mock)
- [ ] 공통원서 작성 → Common Profile 저장
- [ ] 대학/전형/모집단위 선택 (시드 데이터 1개 대학)
- [ ] Application 생성 시 Profile **Snapshot 복사**
- [ ] Draft 자동저장 (Debounce + PATCH + ETag/version)
- [ ] 대학별 추가문항 (JSON Schema 기반 동적 폼)
- [ ] 서류 업로드 (MinIO Presigned URL + 서버측 재검증, AV는 Mock)
- [ ] 결제 (PG Sandbox Adapter — 서버측 재검증 필수)
- [ ] **Finalize** (Idempotency-Key + 조건부 상태전이 + Submission UNIQUE + Outbox + Audit, 단일 트랜잭션)
- [ ] 접수번호 발급 + 접수증 화면
- [ ] Outbox Relay → 중앙 Sync Gateway → 내 원서 Dashboard 요약 반영
- [ ] 상태 Timeline 조회 (Support Self-check 초기형)

### Out of Scope (MVP 제외, M3+)
- 묶음결제 Orchestration, 실제 PG 계약, 선불 캐시
- 관리자 콘솔 전체 (Config 2인 승인은 M3)
- mTLS / Vault / Istio / KCMVP
- Multi-AZ HA, DR 전환, Chaos
- 실명 본인확인(PASS 등), 대교협 연계
- Evidence Package 정식 포맷

### MVP 완료 판정 (Demo Gate)
```
1. 신규 사용자 가입 → 공통원서 작성 → A대 원서 생성 → 자동저장 3회 이상 기록 남음
2. 서류 1건 업로드 → AVAILABLE 전이
3. Sandbox 결제 → 서버측 재검증 통과 → 자동 Finalize → 접수번호 표시
4. Finalize 요청을 동일 Idempotency-Key로 100회 재전송 → Submission 1건
5. central-api를 내린 상태로 1~4 전체 재수행 → 정상 접수완료, 복구 후 Dashboard 자동 반영
```
5번이 통과하는 순간이 이 프로젝트의 **차별성이 처음으로 증명되는 지점**이다. 데모 시연 순서도 5번을 하이라이트로 잡는다.

---

## 5. 마일스톤 — 총 7단계 (M0 ~ M6)

각 단계의 **세부 태스크·개별 목표·인수기준·노션 확인 대상**은 아래 문서에 있다.

| M | 이름 | 1줄 목표 | 완료 기준 | 태스크 문서 |
|---|---|---|---|---|
| **M0** | 기반 구축 | 두 사람이 각자 시작할 수 있게 만든다 | `/healthz` 200 | [M0](milestones/M0-foundation.md) · 8개 |
| **M1** | 접수 Core | 원서를 만들고 저장하고 검증한다 | curl로 전 구간 재현 | [M1](milestones/M1-admission-core.md) · 14개 |
| **M2** | 결제·Finalize·화면 | **화면에서 접수번호를 받는다** | Demo Gate 1~5 | [M2](milestones/M2-payment-finalize-mvp.md) · 24개 |
| **M3** | 운영 안전장치 | 장애가 나도 판정이 가능하게 만든다 | v1.1 §01 E 인수기준 | [M3](milestones/M3-operational-safeguards.md) · 15개 |
| **M4** | 분산 실증 | 장애 격리를 **숫자로** 증명한다 | 3,000 CCU / event loss 0 | [M4](milestones/M4-federated-proof.md) · 25개 |
| **M5** | 신뢰성·보안·접근성 | 대학에 넣을 수 있는 수준으로 만든다 | 보안 게이트 10종 / 키보드 완주 | [M5](milestones/M5-reliability-security.md) · 33개 |
| **M6** | Pilot 준비 | 대학 1곳과 Shadow Test | 실 전형·실 PG·런북 완비 | [M6](milestones/M6-pilot-readiness.md) · 15개 |

**M2가 이번 사이클의 1차 목표**다(= 동작 데모). M3~M6은 "완전한 개발 완료"까지의 로드맵이며, M4 이후는 대회 심사보다 Pilot 계약이 트리거다.

### 단계 정의 매핑 — 문서마다 다른 단계 표기

세 문서가 각각 다른 단계 구분을 쓴다. 목적이 달라서 셋 다 유효하다. 대응관계는 다음과 같다. (불일치 대장 D-6)

| 개발보고서 PDF | 노션 v1.0 §20 | 개발 플랜 | 성격 |
|---|---|---|---|
| 1단계 MVP | Phase 1 — Standard Prototype | **M0 + M1 + M2** | 단일 대학 End-to-End |
| 2단계 분산 실증 | Phase 3 — Production Reliability | **M4** | 중앙단절·Failover·부하 |
| (명시 없음) | Phase 2 — Security & Payment | **M3 + M5** | 결제·보안·감사 |
| 3단계 대학 Pilot | Phase 3~4 | **M6** | 실 전형·PG·운영 검증 |
| 4단계 확산 | Phase 4 — National Scale | (M6 이후) | 다중 대학 Onboarding |

> 심사에서 "보고서는 4단계인데 왜 7단계인가"를 물으면: **보고서 단계는 사업 진행 단위, M0~M6은 개발 실행 단위**다. 위 표가 대응관계다.

## 6. 역할 분담

| 영역 | 담당 | 비고 |
|---|---|---|
| `packages/contracts` | **공동** | 변경 시 반드시 두 사람 리뷰. 여기가 유일한 강제 동기화 지점 |
| `apps/admission-api` | 송리안 | Application/Payment/Finalization/Deadline/Audit/Outbox, DDL, 보안경계 |
| `apps/document-service`, `apps/event-relay` | 송리안 | 서류 파이프라인, Outbox Relay |
| `apps/central-api` | 송리안 (주) / 권민준 (Convenience 모듈) | Sync Gateway는 송리안, Catalog·Dashboard API는 권민준 |
| `apps/frontend` | 권민준 | KRDS 6단계 흐름, 자동저장 클라이언트, Checkout UX, 장애 UX |
| `infra/compose`, CI | 권민준 | 운영 자동화 역량 활용 |
| `deploy/` (Helm·GitOps·K-PaaS) | 송리안 | M4 |
| 부하·장애·복구 테스트 | 공동 | M4에서 페어로 진행 |

**공동 통합 경계**: 지원자 화면의 요청이 대학 Data Plane의 접수 트랜잭션으로 이어지는 구간. 여기만은 혼자 머지하지 않는다.

---

## 7. 태스크는 어디에 있는가

**이 문서에는 태스크를 두지 않는다.** 단계별 문서로 이동했다.

| 찾는 것 | 위치 |
|---|---|
| 단계별 세부 태스크·담당·인수기준 | [`docs/milestones/M0~M6`](milestones/) |
| 태스크마다 읽어야 할 노션 절 | 각 마일스톤 문서의 태스크 표 `근거 노션` 열 |
| 노션을 언제·어떻게 다시 확인하는가 | [01-notion-sync-protocol.md](01-notion-sync-protocol.md) |
| 설계 문서 간 충돌 기록 | [02-spec-discrepancy-register.md](02-spec-discrepancy-register.md) |
| 노션 첨부 8종 배치 현황 | [spec-assets/README.md](spec-assets/README.md) |

### 지금 당장 할 일 (M0 잔여)

- [ ] **T-M0-06** 설계서 첨부 8종 배치 ← **M1 착수 전 선행**
- [ ] **T-M0-07** `npm install` + 헬스체크 확인
- [ ] **T-M0-08** 제출 PDF "Java LTS" 문구 정정

## 8. Definition of Done

모든 PR은 다음을 만족해야 머지한다.

1. **계약 우선** — API 변경은 `packages/contracts`의 OpenAPI를 먼저 고친다. 코드가 계약을 앞서지 않는다.
2. **상태 변경 = 감사 이벤트** — 중요 상태 전이는 `audit_event` INSERT 없이 커밋되지 않는다.
3. **Mutation = Idempotency-Key** — 예외 없음.
4. **PII 금지 구역** — 로그, Metrics Label, Trace Span에 개인정보를 넣지 않는다. 마스킹은 공통 SDK로만.
5. **외부 호출은 트랜잭션 밖** — PG 조회, 메일, PDF, 중앙 전송은 DB 커밋 이후.
6. **테스트** — 상태 전이·Idempotency·마감 경계값은 단위 테스트 필수.

---

## 9. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| 설계서 범위 전체를 MVP에 넣으려는 유혹 | M2 지연 → 데모 없음 | §4 Out of Scope를 계약으로 취급. 신규 요구는 M3 백로그로만 들어간다 |
| Java→NestJS 변경과 제출 문서 불일치 | 심사 시 지적 | T-0으로 문구 정정, ADR-0001을 근거 문서로 첨부 |
| 2인 팀의 contracts 드리프트 | 통합 시점에 폭발 | contracts 변경은 공동 리뷰 + CI breaking-change 검사 |
| 결제 PG 실계약 지연 | M2 블로킹 | Sandbox Adapter 인터페이스를 먼저 고정하고 Mock Provider로 개발. 실 PG는 Adapter 교체만 |
| 로컬 JDK/K8s 환경 편차 | 통합 실패 | 전부 Docker Compose로 고정. 로컬 설치 의존 금지 |
| 부하·DR 테스트를 M4로 미룬 것 | 뒤늦게 구조 결함 발견 | M1부터 Idempotency·Outbox·단일 Writer 원칙을 코드에 박아둔다. M4는 검증이지 설계가 아니다 |

---

## 10. 다음 액션

1. `npm install` → `docker compose -f infra/compose/docker-compose.dev.yml up -d` → 두 API `/healthz` 확인 (T-M0-6)
2. 확인되면 초기 커밋을 `UntameDuck/Wonseoro`에 push
3. M1 착수: `0001_init.sql` DDL부터. 설계서 `02. ERD`의 정합성 규칙 7개를 DB 제약으로 먼저 박는다.
4. 개발보고서 "Java LTS + Spring Boot" 문구 정정 (T-0)

---

## 11. 설계 문서 간 불일치

전체 목록과 처리 상태는 **[02-spec-discrepancy-register.md](02-spec-discrepancy-register.md)** 로 이동했다.

2026-09-22 기준 등록된 6건 요약:

| # | 항목 | 채택 | 상태 |
|---|---|---|---|
| D-1 | 이벤트 네임스페이스 | `kr.kadmission.*` (v1.1 §04) | 🟡 노션 반영 대기 |
| D-2 | 지원자 흐름 단계 | **6단계** (v1.1 §07) | 🟡 노션·PDF 반영 대기 |
| D-3 | 백엔드 런타임 | NestJS + TypeScript (ADR-0001) | 🟡 노션·PDF 반영 대기 |
| D-4 | Finalized 이벤트 sequence 위치 | 확장 속성 `kadmissionsequence` | 🟡 노션 반영 대기 |
| D-5 | **설계서 첨부 8종 미배치** | 수동 배치 필요 | 🔴 **M1 선행** |
| D-6 | 단계 정의가 문서마다 다름 | 매핑표로 고정 (§5) | 🟢 완료 |

새 불일치를 발견하면 **여기가 아니라 대장에 등록한다.** 절차는 [01-notion-sync-protocol.md](01-notion-sync-protocol.md) §4.
