# 다음 단계 (Next Steps)

> 최종 갱신: 2026-09-26 (Admin Web — T-M3-11~14 화면 완료, M3 14/15)
> 이 문서는 **"지금 무엇을 해야 하는가"** 하나만 다룬다.
> 전체 계획은 [00-development-plan.md](00-development-plan.md), 단계별 태스크는 [milestones/](milestones/).
> 작업 착수 전 [01-notion-sync-protocol.md](01-notion-sync-protocol.md) 를 먼저 읽는다.

---

## 현재 지점

**M0·M1·M2 완료, M3 14/15.** MVP 가 화면에서 끝까지 동작하고, 운영 안전장치의 핵심이 붙었다.

| 단계 | 진행 | 비고 |
|---|---|---|
| M0 기반 | 7/8 | 제출문서 정정(T-M0-08)만 남음 |
| M1 접수 Core | **14/14** | ✅ |
| M2 결제·Finalize·화면 | **24/24** | ✅ Demo Gate 1~5 통과 |
| **M3 운영 안전장치** | **14/15** | ◀ 종료 게이트 대기 (T-M3-06 🟡) |
| M4 분산 실증 | 0/28 | |
| M5 신뢰성·보안·접근성 | 0/35 | |
| M6 Pilot 준비 | 0/15 | |

**총 58/139 태스크** (T-M3-06 🟡 부분 완료 별도). 테스트 파일 25개 / **252개 테스트**
(admission-api 202 · server-kit 27 · central-api 19 · event-relay 4) 전부 통과, DB 정합성 제약 14종 PASS.

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
| T-M3-08 Dependency Circuit Breaker | ✅ | 중앙·PG·AV 보고 경로 차단. **PG 는 끊겨도 UNKNOWN** · 중앙 장애가 이벤트를 DEAD 로 만들지 않음 |
| T-M3-06 Autonomous Mode | 🟡 | Health Gate · 자율 운영 배너 · Sync Lag 경보 · 서명된 Policy Snapshot. **JWKS 캐시만 T-M5-02 로** (D-34) |
| T-M3-15 서명된 활성화 기록 | ✅ | 마감·설정의 모든 적용을 Ed25519 로 서명, **추가만 가능한 기록** + 운영자 감사 체인. 공개키로 대학 밖에서 검증 |
| T-M3-09 Purpose-scoped Token | ✅ | 중앙 지원자 참조를 **목적 키 HMAC** 로 — Vault 접근만으로는 조인 불가, 키 교체 지원. 대학 내부 UUID 유출·URL 토큰 제거 |
| T-M3-10 Retention Matrix | ✅ | 데이터 종류별 하한 — **법정 기간을 지어내지 않는다**. 근거 있는 2년만 박고 나머지는 대학이 명시. 설정 승인 절차를 탄다 |
| T-M3-14 마감 연장 워크플로 | ✅ | **입학처 결정 문서번호 필수** · 기준 정책이 바뀌면 적용 거부 · 관리자 콘솔 화면 |
| T-M3-11~13 관리자 콘솔 | ✅ | `apps/admin-web` — 설정 승인(Diff 확인)·대조·증적. **운영 토큰은 브라우저에 없다** |

### 프로덕션 점검 (2026-09-23)

기능이 도는 것과 운영에 올릴 수 있는 것은 다른 문제다.
전수 점검해 고친 내용은 **[04-production-readiness.md](04-production-readiness.md)**.

요약하면 인가가 아예 없었고(D-28), 중앙 Dashboard 가 전체를 반환했고(D-27),
비밀키·소금·대학 식별자에 기본값이 있었다. 지금은 운영에서 기본값 자체를 금지하고,
빠진 설정을 기동 시점에 한 번에 보여준다.

---

## 착수 순서

### 1️⃣ 다음 작업 — M3 종료 게이트

**M3 태스크 15개 중 14개가 끝났다.** 남은 T-M3-06 은 JWKS 캐시 하나이고 T-M5-02 와 함께 한다.
다음 마일스톤으로 가기 전에 종료 체크리스트(M3 문서 하단)를 채운다.

- **노션 §01 을 다시 읽고 C 8종을 대조**한다. C4 **Admission Peak Mode** 는 M3 태스크에 없다 —
  M4(부하 시험)에서 할지 여기서 할지 정해야 한다
- §01 E 인수기준 중 M3 몫: "단독 운영자 1명으로 마감시간 변경 불가" ✅(화면까지) ·
  "Evidence Package 로 재구성" ✅ · "PG Callback 30분 지연 자동 정합화" 는 시험 대기 ·
  "운영계정으로 Audit 삭제 불가" 는 WORM(M5) 대기
- 노션 반영 대기가 쌓였다. 특히 **D-27 · D-29 · D-7 · D-38** 은 확인받아야 방향이 확정된다

### ⚠️ 보존기간 하한값 확인 필요 (D-38)

T-M3-10 은 **틀을 만들었고 숫자는 비어 있다.** 설계서가 숫자로 준 기준은 관리자 접속기록
2년 하나뿐이다. 원서·신원·서류·결제·동의의 하한은 "대학 규정에 따른다" 뿐이라, 플랫폼은
하한을 두지 않고 **대학이 반드시 명시**하게 했다. 개인정보 담당이 법정·기관 하한을 정해 주면
`packages/contracts/src/retention.ts` 의 해당 항목을 `LEGAL` 로 바꾸기만 하면 된다.

### 🟡 T-M3-06 에 남은 것

| 항목 | 언제 | 이유 |
|---|---|---|
| Local JWKS Cache | **T-M5-02 와 함께** | 검증할 토큰 형식·발급자가 아직 없다. 지금 만들면 추측으로 짓는 코드다 |
| Outbox 장기 적체 용량 | M4 (§B7) | 파티션·SENT 아카이브는 DDL 변경. 적체 **경보**는 붙였다 |
| 2시간(§E)·24시간(§A1) 단절 시험 | M4 장애 시험 | 기능은 Demo Gate 5 로 확인됐다. 시간을 버티는지는 부하·장애 시험의 일 |

서명된 Policy Snapshot 은 T-M3-15 로 끝났다 — 공개키(`GET /api/v1/meta/signing-keys`)와
활성화 기록만 있으면 중앙 없이도 대학 밖에서 적용 정책을 검증할 수 있다.

### 관리자 콘솔 (`apps/admin-web`, 포트 4100)

```bash
npm run dev -w @wonseoro/admin-web
```

| 화면 | 하는 일 |
|---|---|
| 설정 승인 | 버전 목록 → Diff(파괴적 변경을 맨 위에) → "확인했습니다" 체크 → 승인 → 2인 뒤 적용 · 되돌리기(사유) |
| 마감 · 연장 | 현재 마감 · 연장 초안(**결정번호 먼저**) · 승인 대기 · 서명된 적용 이력 |
| 대조 · 예외 | 불일치만 심각도순 · 대조 실행 · 처리 코드 + 사유로 해소 (데이터는 고치지 않는다) |
| 증적 조회 | 원서 ID + 사유 → 체인·정책 서명 검증 결과를 맨 위에, 그다음 접수·Timeline |

**운영 토큰은 브라우저에 없다.** 화면은 같은 오리진의 `/api/admin/*` 를 부르고, 콘솔 서버가
`ADMIN_API_TOKEN` 을 붙여 admission-api 로 넘긴다(BFF). admission-api 는 관리자 오리진에 CORS 를
열지 않는다.

⚠️ **담당자 입력은 개발 전용이다.** 적은 이름이 그대로 승인 기록에 남는다 — 신원 증명이 아니다.
그래서 콘솔은 **운영(`NODE_ENV=production`)에서 동작을 거부한다.** 관리자 SSO(T-M5-10)가 붙어야 쓸 수 있다.

---

## 노션 반영 대기 (34건)

불일치 대장 39건 중 **🔴 OPEN 은 0건** — 전부 판정됐다.
5건 CLOSED, 나머지 34건이 노션 반영 대기다. 전체는
[02-spec-discrepancy-register.md](02-spec-discrepancy-register.md).

### 먼저 확인받아야 하는 것

| # | 내용 | 왜 먼저인가 |
|---|---|---|
| **D-29** | `application` 자연키를 부분 유니크로 바꿔 취소된 원서를 제외 | **canonical DDL 의 제약을 약화**하는 변경이다. 다른 항목처럼 덧붙이는 것이 아니다 |
| **D-27** | 중앙 요약에 지원자 참조 `subjectRef` 추가 (D-39 로 목적 키 HMAC 로 바뀜) | 중앙에 가명 식별자를 두는 결정이라 §A3 "최소 정보" 와 함께 봐야 한다 |
| **D-7** | 접수 성립 **후** 취소를 별도 레코드로 둘지 | 지금은 409 로 거부하고 입학처 안내. 실제 운영 규칙이 필요하다 |

### DDL 에 접어 넣어야 하는 것

`infra/db/migrations/0002_integrity_constraints.sql` · `0003_signed_activation.sql` 은 **임시 파일**이다.
노션 §02 첨부 DDL 에 반영한 뒤 삭제한다. (D-21 · D-25 · D-29 · D-35)

### 계약(OpenAPI)에 추가해야 하는 것

D-16 self-check · D-19 form-schema · D-20 scan-result · D-22 policy activate ·
D-24 evidence reason · D-26 reconciliation run · **원서 취소(D-7)** ·
**Config diff/rollback(T-M3-02)** · D-32 dependencies · D-34 operating-mode ·
**D-35 마감 연장 · 적용 이력 · 서명 공개키 · 설정 버전 목록** · D-37 본문 인코딩 400 · D-38 retention matrix·plan · D-39 대시보드 토큰 헤더

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
