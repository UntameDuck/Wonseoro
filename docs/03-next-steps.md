# 다음 단계 (Next Steps)

> 최종 갱신: 2026-09-23 (M3 과반 완료 · 프로덕션 점검 완료)
> 이 문서는 **"지금 무엇을 해야 하는가"** 하나만 다룬다.
> 전체 계획은 [00-development-plan.md](00-development-plan.md), 단계별 태스크는 [milestones/](milestones/).
> 작업 착수 전 [01-notion-sync-protocol.md](01-notion-sync-protocol.md) 를 먼저 읽는다.

---

## 현재 지점

**M0·M1·M2 완료, M3 6/15.** MVP 가 화면에서 끝까지 동작하고, 운영 안전장치의 핵심이 붙었다.

| 단계 | 진행 | 비고 |
|---|---|---|
| M0 기반 | 7/8 | 제출문서 정정(T-M0-08)만 남음 |
| M1 접수 Core | **14/14** | ✅ |
| M2 결제·Finalize·화면 | **24/24** | ✅ Demo Gate 1~5 통과 |
| **M3 운영 안전장치** | **6/15** | ◀ 진행 중 |
| M4 분산 실증 | 0/28 | |
| M5 신뢰성·보안·접근성 | 0/35 | |
| M6 Pilot 준비 | 0/15 | |

**총 50/139 태스크.** 소스 약 14,900줄, 테스트 파일 15개 / **191개 테스트 통과**
(admission-api 163 · central-api 16 · server-kit 12), DB 정합성 제약 12종 PASS.

### 동작하는 것 — End-to-End

```
공통원서 Vault → 동의 필드만 Snapshot → 원서 생성 → 자동저장(ETag·If-Match)
  → 추가문항 동적 검증 → 서류 업로드·magic-byte 검사 → AV 워커 → 결제
  → 서버측 재검증 → Finalize(단일 트랜잭션) → 접수번호 → Outbox
  → event-relay → 중앙 Sync Gateway → 내 원서 Dashboard
```

화면(Next.js·KRDS)에서 사람이 직접 끝까지 진행할 수 있다.
전형·모집단위는 화면에 박혀 있지 않고 **카탈로그 API 에서 읽는다** — 대학이 전형을
하나 늘려도 프론트를 고치지 않는다. (§A5)

### M3 에서 붙은 운영 안전장치

| 태스크 | 상태 | 핵심 |
|---|---|---|
| T-M3-01 Deadline Policy Engine | ✅ | 마감 판정 근거가 **DB 에 승인·활성화 기록이 남은 정책 버전** |
| T-M3-02 Configuration Governance | ✅ | 2인 승인 + **Diff 확인 승인** · Rollback · 마감 임박 Freeze |
| T-M3-03 Audit hash-chain | 🟡 | 체인·변조 검출 완료. WORM 물리 분리는 M5 |
| T-M3-04 Reconciliation Center | ✅ | Application·Payment·Submission·Central ACK 4-way 대조 |
| T-M3-05 Exception Queue | ✅ | 불일치만 큐로, 보정은 사유·before/after 와 함께 |
| T-M3-07 Evidence Package | ✅ | 한 원서의 접수 과정 재구성 + 체인 검증 |

### 프로덕션 점검 (2026-09-23)

기능이 도는 것과 운영에 올릴 수 있는 것은 다른 문제다.
전수 점검해 고친 내용은 **[04-production-readiness.md](04-production-readiness.md)**.

요약하면 인가가 아예 없었고(D-28), 중앙 Dashboard 가 전체를 반환했고(D-27),
비밀키·소금·대학 식별자에 기본값이 있었다. 지금은 운영에서 기본값 자체를 금지하고,
빠진 설정을 기동 시점에 한 번에 보여준다.

---

## 착수 순서

### 1️⃣ 다음 작업 — T-M3-08 Dependency Circuit Breaker

**근거 노션**: §01 C8

지금은 타임아웃과 개별 실패 처리는 있지만, **반복 실패하는 의존성을 끊는 장치가 없다.**
중앙이 느려지면 매 요청이 타임아웃까지 기다렸다가 실패한다. 그 대기가 쌓이면
접수 API 의 커넥션과 스레드를 먹고, 중앙 장애가 결국 접수 장애로 번진다.
**그걸 막는 것이 이 저장소의 존재 이유다.**

끊어야 할 대상
- 중앙 Sync Gateway (event-relay · Profile Vault 조회)
- PG (결제 생성·재검증)
- document-service 보고 경로
- 문자·메일 (아직 없음. 붙을 때 함께)

주의할 것
- **Profile Vault 는 이미 fail-open 이다.** 끊겨도 빈 Snapshot 으로 접수가 계속된다 (D-18).
  Breaker 가 이 성질을 바꾸면 안 된다
- **PG 는 fail-open 하면 안 된다.** 확인 못 한 결제를 CONFIRMED 로 넘기면
  돈을 안 받고 접수시키는 것이다. Breaker 가 열리면 `UNKNOWN` 으로 두고
  Reconciliation 에 맡긴다 (§B4)
- 열린 뒤 반열림(half-open) 복구를 반드시 둔다. 한 번 열리고 안 닫히면
  중앙이 살아나도 통합 조회가 영원히 죽는다

### 2️⃣ T-M3-06 Autonomous Mode

**근거 노션**: §01 A1·C3

중앙이 장기 단절돼도 대학이 **혼자 판단할 수 있어야 한다.**
Local Policy Snapshot · JWKS 로컬 캐시 · Offline Spool.
현재 마감 정책은 이미 대학 DB 에 있어 절반은 되어 있다.
남은 것은 인증 키(JWKS) 캐시인데, 이것은 실제 인증(T-M5-02)과 맞물린다.
**T-M5-02 보다 먼저 하면 헛일이 될 수 있다** — 순서를 검토할 것.

### 3️⃣ T-M3-11~13 Admin Web (권민준)

백엔드 API 는 전부 준비돼 있다.

| 화면 | 호출 |
|---|---|
| Config 승인 (T-M3-11) | `GET /admin/v1/config/versions/{id}/diff` → `POST .../approve` (digest 동봉) |
| Reconciliation 콘솔 (T-M3-12) | `GET /admin/v1/reconciliation/exceptions` · `POST .../run` · `POST /{id}/resolve` |
| Evidence 조회 (T-M3-13) | `GET /admin/v1/evidence/applications/{id}?reason=` |

**T-M3-11 이 §01 E 의 인수기준을 화면에서 증명한다.**
"단독 운영자 1명으로 마감시간 변경 불가" 가 UI 에서 강제되는 것을 보여야 한다.
Diff 를 읽히게 그리는 것이 핵심이다 — 읽히지 않는 Diff 는 없는 Diff 와 같다.

⚠️ 운영 API 는 `Authorization: Bearer <ADMIN_API_TOKEN>` 이 필요하다.

---

## 노션 반영 대기 (25건)

불일치 대장 30건 중 **🔴 OPEN 은 0건** — 전부 판정됐다.
5건 CLOSED, 나머지 25건이 노션 반영 대기다. 전체는
[02-spec-discrepancy-register.md](02-spec-discrepancy-register.md).

### 먼저 확인받아야 하는 것

| # | 내용 | 왜 먼저인가 |
|---|---|---|
| **D-29** | `application` 자연키를 부분 유니크로 바꿔 취소된 원서를 제외 | **canonical DDL 의 제약을 약화**하는 변경이다. 다른 항목처럼 덧붙이는 것이 아니다 |
| **D-27** | 중앙 요약에 `subjectRef`(= sha256(subject_token)) 추가 | 중앙에 가명 식별자를 두는 결정이라 §A3 "최소 정보" 와 함께 봐야 한다 |
| **D-7** | 접수 성립 **후** 취소를 별도 레코드로 둘지 | 지금은 409 로 거부하고 입학처 안내. 실제 운영 규칙이 필요하다 |

### DDL 에 접어 넣어야 하는 것

`infra/db/migrations/0002_integrity_constraints.sql` 은 **임시 파일**이다.
노션 §02 첨부 DDL 에 반영한 뒤 삭제한다. (D-21 · D-25 · D-29)

### 계약(OpenAPI)에 추가해야 하는 것

D-16 self-check · D-19 form-schema · D-20 scan-result · D-22 policy activate ·
D-24 evidence reason · D-26 reconciliation run · **원서 취소(D-7)** ·
**Config diff/rollback(T-M3-02)**

---

## 아직 안 된 것 — 솔직하게

| 항목 | 현재 | 언제 |
|---|---|---|
| **인증** | `AUTH_MODE=dev-headers`. 헤더를 믿는다. 운영에서는 기동이 막힌다 | T-M5-02 |
| **운영자 인증** | `ADMIN_API_TOKEN` 공유 비밀. 누가 했는지 구분 못 한다 | T-M5-10 |
| **실 PG** | Mock. 운영에서 선택되면 기동이 막힌다 | T-M5-06 |
| **실 안티바이러스** | Mock. 확장자·크기만 본다 | T-M5-08 |
| **WORM 감사 저장소** | 같은 DB 안에 있다. 체인은 검증되지만 물리 분리는 아니다 | M5 |
| **K-PaaS 배포** | Helm·GitOps 미구성. 지금은 로컬 docker compose | M4 |
| **부하·장애 시험** | 숫자 없음. SLO 는 목표값이지 실측이 아니다 | M4 |
| **제출 PDF 정정** | "Java LTS + Spring Boot" 로 적혀 있다 (실제는 NestJS) | T-M0-08 |

---

## 개발 환경 되살리기

```bash
npm install
npm run dev:infra            # postgres(univ_a 5432 / central 5434), MinIO
npm run db:migrate           # 0001 + 0002
npm run db:migrate:central
npm run db:seed
npm run db:verify            # 정합성 제약 12종이 실제로 막는지 확인
npm run build
```

서비스는 각 앱의 `.env.example` 을 `.env` 로 복사해 띄운다.
**운영 모드(`NODE_ENV=production`)에서는 설정이 빠지면 기동하지 않는다.**
무엇이 빠졌는지 한 번에 알려준다.

테스트는 DB 가 있어야 통합 테스트까지 돈다.

```bash
DATABASE_URL=postgresql://wonseoro:wonseoro@localhost:5432/univ_a \
UNIVERSITY_ID=UNIV-A npm test --workspace @wonseoro/admission-api
```
