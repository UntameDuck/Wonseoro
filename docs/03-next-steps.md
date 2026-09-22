# 다음 단계 (Next Steps)

> 최종 갱신: 2026-09-23 (M2 완료)
> 이 문서는 **"지금 무엇을 해야 하는가"** 하나만 다룬다.
> 전체 계획은 [00-development-plan.md](00-development-plan.md), 단계별 태스크는 [milestones/](milestones/).
> 작업 착수 전 [01-notion-sync-protocol.md](01-notion-sync-protocol.md) 를 먼저 읽는다.

---

## 현재 지점

**M0·M1·M2 완료.** MVP 가 화면에서 끝까지 동작한다. 다음은 M3 운영 안전장치다.

| 단계 | 진행 | 비고 |
|---|---|---|
| M0 기반 | 7/8 | 제출문서 정정만 남음 |
| M1 접수 Core | **14/14** | ✅ |
| **M2 결제·Finalize·화면** | **24/24** | ✅ Demo Gate 1~5 통과 |
| **M3 운영 안전장치** | **0/15** | ◀ 다음 |
| M4 분산 실증 | 0/28 | |
| M5 신뢰성·보안·접근성 | 0/35 | |
| M6 Pilot 준비 | 0/15 | |

동작하는 것 (백엔드 End-to-End)
```
공통원서 Vault → 동의 필드만 Snapshot → 원서 생성 → 자동저장(ETag)
  → 추가문항 검증 → 서류 업로드·magic-byte 검사 → 결제 → 서버측 재검증
  → Finalize → 접수번호 → Outbox → event-relay → 중앙 Sync Gateway → Dashboard
```
테스트 **102개** (대학 86 + 중앙 16). **Demo Gate 1~5 전부 통과.**

아직 없는 것: **프론트엔드 전체**. 화면이 없어 사람이 눈으로 보는 데모는 curl 이다.

---

## 착수 순서

### 1️⃣ 다음 작업 — 프론트엔드 (T-M2-20 ~ T-M2-32, 13개)

**백엔드 계약이 전부 잠겼다.** 이제 화면을 만들어도 헛일이 되지 않는다.

권장 순서
```
1. KRDS 토큰·컴포넌트 래퍼 SDK   (T-M2-20)  ← 먼저. 나머지가 전부 이것 위에 얹힌다
2. Step Indicator + Breadcrumb   (T-M2-21)
3. 1~6단계 화면                   (T-M2-22~27)
4. 완료 화면                      (T-M2-28)
5. 자동저장 클라이언트            (T-M2-29)
6. 마감 카운트다운                (T-M2-30)
7. 장애 UX                        (T-M2-31)  ← 경쟁 서비스와 갈리는 지점
8. 내 원서 Dashboard              (T-M2-32)
```

붙일 API 는 전부 준비되어 있다.

| 화면 | 호출 |
|---|---|
| 공통정보 | `POST /internal/v1/profiles` (중앙) |
| 대학·전형 | `GET /api/v1/admission-types`, `/departments` |
| 추가정보 | `PATCH /api/v1/applications/{id}` + `POST .../validate` |
| 서류 | `POST .../documents/upload-intents` → Object Storage 직접 PUT → `POST /documents/{id}/complete` |
| 검토·결제 | `POST .../payment-intents` → `POST /payments/{id}/verify` |
| 최종제출 | `POST .../finalize` |
| 완료 | `GET .../submission`, `GET /submissions/{id}/receipt` |
| 마감 표시 | `GET /api/v1/meta/time` ← **브라우저 시간 금지** |
| 장애 UX | `GET .../self-check` ← 상태·이력·안내문구가 이미 다 온다 |
| Dashboard | `GET /api/v1/dashboard/applications` (중앙) |

타협 불가 항목 ([§07](https://app.notion.com/p/3df75ab5debe812db3d1e06d0761e38e))
- 마감 표시는 **서버 시간** 기준. 브라우저 시간 금지
- 자동저장 상태를 항상 텍스트로: `저장 중` / `저장 완료 17:42:13` / `저장 실패 — 다시 시도`
- 오류는 상단 Error Summary + 필드 인접 메시지를 **동시에**
- 중요 결과를 Toast 만으로 알리지 않는다
- 장애 시 처음부터 다시 하라고 요구하지 않는다. 요청번호 + 상태 재조회 버튼
- 중앙 Sync 지연은 접수완료 여부와 **분리 표시**
  (`self-check` 응답의 `centralSync.guidance` 를 그대로 쓰면 된다)

### 2️⃣ 그 다음 — M3 운영 안전장치 (15개)

대회 심사 관점에서 가장 설득력 있는 구간이다. 2026년 장애에서 실제로 문제가 된 지점을 고친다.

우선순위
1. **Deadline Policy Engine** (T-M3-01) — 마감 판정 기준을 서명된 정책 버전으로
2. **Config 2인 승인** (T-M3-02) — 운영자 1명이 마감시간을 못 바꾸게
3. **Evidence Package** (T-M3-07) — 특정 원서의 접수 과정을 재구성
4. Reconciliation Center (T-M3-04)
5. Autonomous Mode (T-M3-06)

1·2번의 DB 제약은 이미 들어가 있다 (`CHECK (approved_by_1 <> approved_by_2)`).
엔진만 얹으면 된다.

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
