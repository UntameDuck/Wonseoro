# 설계 불일치 대장 (Spec Discrepancy Register)

> 기록 규칙은 `01-notion-sync-protocol.md` §4.
> 불일치를 발견하면 **조용히 한쪽을 고치지 말고 여기에 먼저 올린다.**

## 상태 정의

| 상태 | 의미 |
|---|---|
| 🔴 OPEN | 발견만 됨. 아직 어느 쪽이 맞는지 판정 안 됨 |
| 🟡 판정완료 | canonical 결정됨. 패자 쪽 수정 대기 |
| 🟢 CLOSED | 양쪽 문서·코드가 모두 일치하도록 반영 완료 |

---

## D-1. 이벤트 네임스페이스

| | |
|---|---|
| **발견** | 2026-09-22 (M0) |
| **충돌** | 노션 v1.0 §6.2 예시 JSON은 `kr.admission.*` / v1.1 §04는 `kr.kadmission.*` |
| **판정** | **`kr.kadmission.*`** — v1.1이 최신이며 §04가 CloudEvents의 canonical 문서 |
| **저장소 반영** | ✅ `packages/contracts/src/events.ts` |
| **노션 반영** | ✅ v1.0 §6.2 예시 이벤트 이름 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-2. 지원자 흐름 단계 수

| | |
|---|---|
| **발견** | 2026-09-22 (M0) |
| **충돌** | 개발보고서 PDF **5단계** / v1.0 §12.1 정보구조 **10항목** / v1.1 §07 Step Indicator **6단계** |
| **판정** | **6단계** — v1.1 §07이 KRDS 단계 표시기 권장 범위에 맞춰 정리한 최신 결정 |
| **6단계** | 공통정보 → 대학·전형 → 추가정보 → 서류 → 검토·결제 → 최종제출 (→ 완료) |
| **저장소 반영** | ✅ `apps/frontend/` 디렉터리 구조 + README |
| **노션 반영** | ✅ v1.0 §12.1·§12.2 6단계 (2026-09-27) |
| **PDF 반영** | ⬜ 정정 문구 준비 완료 — [07-submission-errata.md](07-submission-errata.md). 제출처 반영은 사람 |
| **상태** | 🟡 노션 반영 완료 — 제출 PDF 정정 대기 |

---

## D-3. 백엔드 런타임

| | |
|---|---|
| **발견** | 2026-09-22 (M0) |
| **충돌** | 노션 v1.0 §4 "Java LTS + Spring Boot 계열" / 팀 실제 역량은 Node·TypeScript |
| **판정** | **NestJS + TypeScript (Node LTS)** — ADR-0001 참조 |
| **근거** | 설계서가 요구하는 실질은 ① ACID 트랜잭션 ② Outbox ③ 관측성 ④ 장기지원 런타임이며 Node LTS + PostgreSQL이 모두 충족 |
| **저장소 반영** | ✅ ADR-0001, 전 앱 스캐폴딩 |
| **노션 반영** | ✅ v1.0 §4 Backend 행 (2026-09-27) |
| **PDF 반영** | ⬜ 정정 문구 준비 완료 — [07-submission-errata.md](07-submission-errata.md). 제출처 반영은 사람 |
| **상태** | 🟡 노션 반영 완료 — 제출 PDF 정정 대기 |

---

## D-4. Finalized 이벤트의 sequence 위치

| | |
|---|---|
| **발견** | 2026-09-22 (M0) |
| **충돌** | v1.0 §6.2 최소 이벤트 payload에 sequence 없음 / v1.1 §A3·§04는 Application별 단조 증가 sequence 요구 |
| **판정** | **CloudEvents 확장 속성 `kadmissionsequence`로 전달** — data 본문에 넣지 않는다 |
| **근거** | v1.1 §04가 확장 속성 목록에 `kadmissionsequence`를 명시 |
| **저장소 반영** | ✅ `packages/contracts/src/events.ts` (`KAdmissionExtensions`) |
| **노션 반영** | ✅ v1.0 §6.2 kadmissionsequence (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-5. 설계서 첨부 8종 미배치

| | |
|---|---|
| **발견** | 2026-09-22 (M0) |
| **문제** | 구현 기준이 되는 canonical 첨부파일이 저장소에 없다 |
| **대상** | DDL · OpenAPI yaml · CloudEvents json · Helm values-m · runtime yaml · network-rbac yaml · vault policy · KRDS 와이어프레임 html · k6 js · STRIDE csv |
| **원인** | Notion MCP 연동 소유가 아니어서 API 다운로드 불가 (`object_not_found`) |
| **조치** | Notion 세션이 있는 브라우저에서 `/api/v3/getSignedFileUrls` 로 서명 URL을 받아 본문을 읽어 배치 |
| **영향** | M1 착수 전 선행 작업 |
| **진행** | 2026-09-22: **DDL · OpenAPI · CloudEvents 3종 배치 완료.** 원본과 바이트 단위 일치 검증 (문자수·줄수·체크섬) |
| **잔여** | Helm values-m · runtime · network-rbac · vault policy · KRDS 와이어프레임 · k6 · STRIDE register (7종) — M4/M5 착수 전까지 |
| **M4 에 필요한 3종 (2026-09-26 확인)** | `k-admission-k6.js.txt` (§08, att `846bc806-699f-4852-b6c0-fcaeb7dee39f`, block `4df25cda-c2c6-4593-8657-13ba7bb4adb6`) · `k-admission-values-m.yaml` (§05, att `96ef60d0-5d8a-4a09-8ded-5ab794a3da73`, block `a4fa4603-b518-4b73-b8c7-577f4668c4dd`) · `k-admission-runtime.yaml` (§05, att `4cd23155-7587-47f4-80b3-fc2568d8fd7c`, block `1d2ae3da-8232-4800-a382-58c820d26be3`). §05·§08 본문에는 레플리카·리소스·HPA 숫자가 없다 — 전부 첨부 안에 있다 |
| **완료 (2026-09-27)** | 남은 7종 배치 — values-m · runtime · network-rbac · vault policy · KRDS 와이어프레임 · k6 · STRIDE. 로그인된 브라우저 세션에서 서명 URL 로 받아 **브라우저에서 계산한 SHA-256 과 저장소 파일의 SHA-256 이 모두 같다.** 첨부 10종 전부 배치 |
| **상태** | 🟢 CLOSED — 첨부 10종 배치 (2026-09-27) |

### 배치 절차 (재현용)

Notion MCP `download-attachment` 는 이 연동이 만든 업로드만 받을 수 있어 404가 난다.
로그인된 브라우저에서 아래로 받는다.

```js
// 노션 페이지 탭에서 실행. attId/name/blockId 는 페이지 fetch 결과의 file src 에서 얻는다.
const r = await fetch('/api/v3/getSignedFileUrls', {
  method:'POST', headers:{'content-type':'application/json'}, credentials:'include',
  body: JSON.stringify({urls:[{url:`attachment:${attId}:${name}`,
    permissionRecord:{table:'block', id:blockId, spaceId:'<spaceId>'}}]})
});
const text = await (await fetch((await r.json()).signedUrls[0], {credentials:'omit'})).text();
```

배치 후 **문자수·줄수·체크섬**을 원본과 대조해 훼손이 없는지 확인한다.

---

## D-6. 단계 정의가 문서마다 다름

| | |
|---|---|
| **발견** | 2026-09-22 (M0) |
| **충돌** | 개발보고서 PDF **1~4단계** / 노션 v1.0 §20 **Phase 1~4** / 개발 플랜 **M0~M6** |
| **판정** | 셋 다 유효. 목적이 다르다 (사업 서술 / 제품 성숙도 / 개발 실행 단위) |
| **조치** | `00-development-plan.md` §5에 3벌 매핑표를 넣어 대응관계를 고정 |
| **상태** | 🟢 CLOSED |

---

## D-7. Application 상태에 CANCELLED 가 있으나 상태머신에 정의가 없다

| | |
|---|---|
| **발견** | 2026-09-22 (M1) |
| **충돌** | DDL `application.status` CHECK 와 OpenAPI `Application.status` enum 에는 `CANCELLED` 가 있으나, v1.0 §5.6 상태 다이어그램에는 없다. `kr.kadmission.application.cancelled.v1` 이벤트도 존재한다 |
| **문제** | 어느 상태에서 누구의 권한으로 CANCELLED 로 가는지 정의가 없다. 특히 `FINALIZED → CANCELLED` 허용 여부는 "접수 완료는 되돌릴 수 없다"는 핵심 원칙과 충돌한다 |
| **판정 (2026-09-23)** | **취소는 하나가 아니라 두 가지 다른 일이다.** 둘을 같은 상태로 표현하려 해서 정의가 막혀 있었다 |
| **① 접수 성립 전** | `DRAFT` · `READY` · `PAYMENT_PENDING` · `PAID` → `CANCELLED`. 아직 접수가 성립하지 않았으므로 되돌릴 것이 없다. 지원자 본인이 한다 |
| **② 접수 성립 후** | **이 상태로 표현하지 않는다.** Submission 은 원장이다. 원장을 고쳐 쓰면 "무엇이 접수되었는가" 에 답할 수 없고, 감사 해시체인과 Evidence Package 가 서 있는 전제가 무너진다. 필요하다면 상태를 덮는 것이 아니라 **취소 사실을 덧붙이는** 별도 레코드여야 한다 — 계약에 없으므로 지금은 409 로 거부하고 입학처로 안내한다 |
| **③ FINALIZING** | 취소하지 않는다. Finalize 가 비행 중이라 취소와 커밋이 경합하면 "취소했는데 접수됨" 이 생긴다. 조건부 UPDATE 와 Outbox 로 막아온 것이 정확히 그 종류의 사고다. 409 를 주되 "잠시 후 다시 확인" 으로 안내한다 — 영구 불가로 말하면 사용자가 포기한다 |
| **④ 환불 연계** | **자동으로 환불하지 않는다.** 확정된 결제가 있으면 `REFUND_REQUIRED_AFTER_CANCEL` 을 Exception Queue 에 올리고 끝낸다. 금액과 귀책 판단이 따르고 되돌릴 수 없는 일이다 (§B16). 결제 상태는 실제 환불 전까지 `CONFIRMED` 로 둔다 — 미리 `REFUNDED` 로 적으면 장부가 거짓이 된다 |
| **⑤ 사유 필수** | 사유 없는 취소는 나중에 분쟁이 됐을 때 아무것도 설명하지 못한다. 다만 **중앙으로 나가는 이벤트에는 사유를 넣지 않는다** — 개인 사정이고 중앙이 알아야 할 이유가 없다 (§A3) |
| **딸려 나온 것** | 감사 액션 `APPLICATION_CANCELLED` 가 §9 목록에 없었다. `audit_event.action` 에 CHECK 가 없어 저장은 되지만 계약에는 추가가 필요하다. 취소 API 경로도 OpenAPI 에 없다 |
| **저장소 반영** | ✅ `application-state.ts` 전이·헬퍼 · `modules/cancellation/` · 대조 8번 검사 · 통합 테스트 12종 |
| **노션 반영** | ✅ §03 첨부 yaml v1.2.0 교체(cancel) (2026-09-27) · ✅ §03 본문 cancel (2026-09-27) · ✅ v1.0 §5.6 접수 전 취소 전이 (2026-09-27) · ✅ v1.0 §9 APPLICATION_CANCELLED (2026-09-27) · ✅ v1.0 §5.6 에 "접수 후 취소 없음(409), 전형료 반환은 시행령 사유로 결제 쪽" 명시 (2026-09-27 확정) (2026-09-27) |
| **결정 (2026-09-27)** | **접수 후 취소는 별도 레코드로 두지 않는다 — 409 유지.** 대학입학전형기본사항: "접수된 원서의 취소는 원칙적으로 불가", '접수된 원서' = 수험번호가 부여된 원서. 전형료 반환은 「고등교육법 시행령」 제42조의3 사유(과오납·대학 귀책·천재지변·질병/사고 입원·사망)로만 — 접수 원장을 두고 **결제 쪽 반환 기록**으로 다룬다(실 PG, T-M6-04). 접수 전 취소(PAID 포함)는 수험번호가 없으므로 현행 규정과 충돌하지 않는다 |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-8. Payment 상태값이 달랐다

| | |
|---|---|
| **발견** | 2026-09-22 (M1) |
| **충돌** | M1 초안 contracts: `INTENT_CREATED, APPROVED, CANCELED` / canonical DDL·OpenAPI: `CREATED, CANCELLED, REFUNDED` (APPROVED 없음) |
| **판정** | **canonical 채택** — `CREATED, PENDING, UNKNOWN, CONFIRMED, FAILED, CANCELLED, REFUNDED` |
| **비고** | `APPROVED` 가 없는 것은 의도적으로 보인다. PG 승인만으로는 Finalize 할 수 없고 **서버 재검증을 거친 `CONFIRMED` 만** 사용 가능하다는 설계와 일치한다. 승인 시각은 별도 컬럼 `provider_approved_at` 으로 보존한다 |
| **저장소 반영** | ✅ `packages/contracts/src/payment-state.ts` |
| **상태** | 🟢 CLOSED |

---

## D-9. Deadline Policy 필드명이 달랐다

| | |
|---|---|
| **발견** | 2026-09-22 (M1) |
| **충돌** | M1 초안: `rule`, `policyVersion`, `approvedBy: [A, B]` / canonical: `mode`, `version`(DDL) · `deadlinePolicyVersion`(OpenAPI ServerTime), `approved_by_1` · `approved_by_2` |
| **판정** | **canonical 채택.** 승인자는 배열이 아니라 두 컬럼이다 — DDL 이 `CHECK (approved_by_1 <> approved_by_2)` 로 단독 승인을 DB 레벨에서 막기 때문이다 |
| **저장소 반영** | ✅ contracts · DeadlineService · `/meta/time` · 테스트 |
| **상태** | 🟢 CLOSED |

---

## D-10. Problem 에 code 와 traceId 가 필수였다

| | |
|---|---|
| **발견** | 2026-09-22 (M1) |
| **충돌** | M1 초안 ProblemDetails 에 `code` 없음, `traceId` 선택 / OpenAPI `Problem.required: [type, title, status, code, traceId]` |
| **판정** | canonical 채택. 분쟁 시 사건을 특정하는 두 필드이므로 선택일 수 없다 |
| **저장소 반영** | ✅ `problem.ts` · `ProblemException` · `ProblemFilter` (filter 가 traceparent/X-Request-Id 에서 traceId 주입) |
| **상태** | 🟢 CLOSED |

---

## D-11. idempotency_record 상태값이 달랐다

| | |
|---|---|
| **발견** | 2026-09-22 (M1) |
| **충돌** | M1 초안: `IN_FLIGHT, COMPLETED` / DDL: `PROCESSING, COMPLETED, FAILED` |
| **판정** | canonical 채택. `FAILED` 는 실패한 요청을 기록으로 남기는 상태다 |
| **비고** | 현재 메모리 어댑터는 실패 시 레코드를 삭제(`release`)한다. Postgres 어댑터에서는 삭제 대신 `FAILED` 로 전이시키고 `expires_at` 으로 정리해야 한다 — DDL 이 그렇게 설계되어 있다 |
| **저장소 반영** | ✅ `postgres-idempotency.store.ts` — 실패는 삭제하지 않고 `FAILED` 로 남긴다 · 시험 "실패는 FAILED 로 남는다" |
| **상태** | 🟢 CLOSED — 저장소 반영 확인 (2026-09-27) |

---

## D-12. idempotency_record 로는 원서 생성을 멱등화할 수 없다

| | |
|---|---|
| **발견** | 2026-09-22 (M1, Postgres 어댑터 구현 중) |
| **문제** | DDL `idempotency_record.application_id uuid NOT NULL REFERENCES application(id)`. 그런데 `POST /api/v1/applications` 시점에는 아직 application 이 없다. OpenAPI 는 이 엔드포인트에도 `Idempotency-Key` 를 **필수**로 요구한다 |
| **판정** | **생성의 멱등성은 자연키가 보장한다.** DDL `application UNIQUE (cycle_id, applicant_id, admission_type_id, department_id)` 가 같은 지원자의 같은 전형·모집단위 중복 생성을 막는다 |
| **구현** | `INSERT ... ON CONFLICT DO NOTHING` 후 기존 행을 조회해 반환한다. 신규 생성은 201, 재시도는 200 |
| **효과** | 네트워크 재시도로 원서가 두 개 생기지 않는다. Idempotency-Key 가 달라도 막힌다 — 키보다 강한 보장이다 |
| **남은 선택지** | ① 현행 유지(자연키) ② `application_id` 를 nullable 로 바꿔 생성도 레코드화. ②를 택하면 DDL 변경이므로 **노션 첨부를 먼저 고쳐야 한다** |
| **노션 반영** | ✅ §02·§03 "생성은 자연키로 멱등" (2026-09-27). 자연키는 D-29 로 `(cycle_id, applicant_id, admission_type_id)` 가 됐다 |
| **상태** | 🟢 CLOSED — 현행 유지(자연키), 노션 반영 (2026-09-27) |

---

## D-13. audit_event 는 application 삭제로 지워지지 않는다 (의도된 설계로 확인)

| | |
|---|---|
| **발견** | 2026-09-22 (M1, 통합 테스트 정리 중) |
| **관찰** | `application_field_value` · `document` · `idempotency_record` 는 `ON DELETE CASCADE` 인데 **`audit_event` 만 CASCADE 가 없다** |
| **해석** | 의도된 설계로 본다. 원서를 지우는 것으로 감사 기록을 없앨 수 없어야 한다 (v1.1 §A11 — 감사로그 삭제·수정 권한을 운영자에게 주지 않는다) |
| **조치** | 통합 테스트에 "원서를 지워도 감사 레코드는 FK 로 보호된다"를 인수 항목으로 추가했다 |
| **확인 필요** | 노션 §02 본문에 이 의도를 명시하면 좋다. 지금은 DDL 에만 암묵적으로 있다 |
| **상태** | 🟢 CLOSED — 설계 의도 확인, 테스트로 고정 |

---

## D-14. 중앙 DB 스키마에 canonical DDL 이 없다

| | |
|---|---|
| **발견** | 2026-09-22 (M2, Sync Gateway 착수) |
| **문제** | 노션 첨부 `k-admission-postgresql-ddl.txt` 는 **대학 Data Plane 전용**이다. 중앙(central-api)이 무엇을 어떤 스키마로 저장하는지 DDL 이 없다 |
| **근거는 있다** | v1.0 §17.1 이 중앙 수집 범위를 규정한다 — 대학 ID / 전형연도·전형·모집단위 코드 / Opaque Application ID / 상태 / 제출시각 / Event 무결성 값. §3.1 이 Sync Gateway·Aggregate Store 역할을, §04 가 dedup 키(`source`+`id`)와 sequence 규칙을 정한다 |
| **판정** | 위 문서들이 정한 범위 **안에서만** 중앙 스키마를 작성한다. 대학 DDL 을 복사하지 않는다 |
| **저장소** | `infra/db/central/0001_init.sql` — 저장소가 1차 작성했음을 파일 상단에 명시 |
| **노션 반영** | ✅ 중앙 DDL 을 §04 또는 새 절의 첨부로 추가해야 한다. 그래야 다음부터 저장소가 원본이 되지 않는다 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-15. 접수번호가 중앙에 가는지 문서마다 다르다

| | |
|---|---|
| **발견** | 2026-09-22 (M2) |
| **충돌** | v1.0 §17.1 "중앙 기본 수집" 목록에 **접수번호가 없다** / canonical CloudEvents 스키마는 `ApplicationFinalizedData.required` 에 **`applicationNumber` 를 포함**한다 |
| **판정** | **첨부(CloudEvents 스키마)를 채택한다.** 판정 우선순위상 첨부가 본문 서술보다 위다 (§4) |
| **근거** | 내 원서 Dashboard 가 접수번호를 보여주려면 중앙에 있어야 한다. 접수번호는 지원자 본인에게 이미 노출되는 값이고, 무작위라 다른 지원자를 훑는 데 쓸 수 없다 (§09 BOLA 대응 완료) |
| **주의** | 그래도 접수번호는 **식별자**다. 중앙 로그·Metrics Label 에 넣지 않는다 |
| **노션 반영** | ✅ v1.0 §17.1 접수번호·근거 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-16. Support Self-check 가 필수 기능인데 OpenAPI 에 없다

| | |
|---|---|
| **발견** | 2026-09-22 (M2) |
| **충돌** | v1.1 §01 **C7 이 "Support Self-check"를 필수 신규 기능으로 규정**하고 §B11 이 장애 시 고객센터 폭주 완화 수단으로 지목한다. 그런데 canonical OpenAPI 의 Applicant API 16개 엔드포인트에 해당 경로가 없다 |
| **왜 중요한가** | 2026년 장애 때 지원자가 자기 상태를 확인할 길이 고객센터뿐이었다. "서버가 아는 상태"를 사용자가 직접 보는 것이 이 제품이 고치려는 지점이다 |
| **판정** | **구현한다.** 기능 요구(§01 C7)가 계약 누락보다 우선한다 |
| **구현 경로** | `GET /api/v1/applications/{applicationId}/self-check` |
| **노션 반영** | ✅ §03 첨부 yaml v1.2.0 교체 (2026-09-27) · ✅ §03 본문 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-17. Common Profile Vault 의 API 가 어디에도 정의되어 있지 않다

| | |
|---|---|
| **발견** | 2026-09-22 (M2, T-M1-09 착수) |
| **충돌** | v1.1 §10 §3 이 "대학이 중앙 Vault 에 필요 필드를 요청 → Profile Snapshot 수신" 흐름을 그림으로 규정한다. v1.0 §3.1 도 Common Profile Vault 를 중앙 구성요소로 명시한다. **그런데 이 호출의 API 계약이 OpenAPI 어디에도 없다** |
| **판정** | 중앙 내부 API 로 구현한다. `POST /internal/v1/profile-snapshots` |
| **저장 위치 결정** | v1.0 §5 가 "공통원서는 **Control Plane 과 분리된** Applicant Common Profile Vault 에서 관리한다"고 명시한다. 따라서 Sync Gateway 의 집계 DB(`kadmission_central`)와 **같은 스키마에 두지 않는다.** 별도 스키마 `kadmission_vault` 를 쓴다 |
| **운영 시** | 별도 DB 인스턴스 + 자체 KMS 로 분리한다. 한 스키마에 두면 §8.3 의 "Vault 가 새로운 개인정보 집중 위험이 되지 않도록 통제"가 깨진다 |
| **노션 반영** | ✅ §03 본문·첨부 yaml v1.2.0 에 Vault Snapshot 계약 (2026-09-27). 동의 버전을 응답에 싣는 보강은 M5(Vault 분리) |
| **결정 (2026-09-27)** | **현재 형식으로 확정** — `requestedFields ∩ 동의` 만 내보내고 나머지는 `withheldFields` 로 명시. 보강 1건: 대학이 제3자 제공 동의(받는 자·목적·항목·보유기간, 개인정보보호법 제17조)를 기록할 수 있게 응답에 동의 버전을 싣는다 — 중앙 Vault 동의 모델 확장이 필요해 M5(Vault 분리)와 함께 |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-18. 중앙 장애 시 원서 "생성"이 가능한지가 불명확하다

| | |
|---|---|
| **발견** | 2026-09-22 (M2) |
| **문제** | §10 §1 표는 공통원서 프로필 행에서 "**Snapshot 생성 후** 작성·제출은 중앙과 무관"이라고 적는다. 즉 Snapshot 생성 **시점**에는 중앙이 필요하다. 그러면 중앙 장애 중에는 새 원서를 못 만드는가? |
| **같은 표의 다른 행** | 대학/전형 검색 행은 "중앙 검색 장애여도 **대학 직접 URL 접수 가능**"이라고 적는다. 새 원서 생성이 막히면 이 문장과 모순된다 |
| **판정** | **Snapshot 은 best-effort 다.** 중앙이 응답하지 않으면 빈 원서로 생성하고 사용자가 직접 입력한다. 생성 자체를 막지 않는다 |
| **근거** | 중앙은 편의 계층이다. 편의가 없다고 접수 기회를 잃으면 이 제품의 전제가 무너진다 |
| **노션 반영** | ✅ §10 §1 표에 "중앙 장애 시 신규 원서는 Snapshot 없이 생성" 을 명시 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-19. 동적 폼 렌더링에 필요한 Schema 조회 API 가 없다

| | |
|---|---|
| **발견** | 2026-09-23 (M2 프론트) |
| **문제** | v1.1 §A5 는 "대학 차이를 코드 fork 가 아니라 **Configuration + JSON Schema**로 흡수"를 요구한다. 백엔드는 그렇게 되어 있다 — Config 만 바꾸면 새 전형이 동작한다. **그런데 화면이 그 스키마를 받아올 방법이 없다** |
| **결과** | 프론트가 입력 필드를 하드코딩하게 된다. 전형이 늘 때마다 화면을 고쳐야 하므로 §A5 의 주장이 **UI 에서 깨진다** |
| **근거** | canonical OpenAPI 의 `AdmissionType` 스키마는 `id/code/name/feeAmount` 만 담는다. 추가문항 정의를 실어 보내지 않는다 |
| **판정** | **조회 API 를 추가한다.** `GET /api/v1/applications/{applicationId}/form-schema` |
| **왜 application 단위인가** | 스키마는 전형 × 활성 Config 버전의 조합으로 정해진다. 원서는 이미 둘 다 알고 있으므로 클라이언트가 조합을 계산할 필요가 없다 |
| **노션 반영** | ✅ §03 첨부 yaml v1.2.0 교체(form-schema 조회 API 방식) (2026-09-27) · ✅ §03 본문 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-20. AV 검사 워커용 내부 API 가 계약에 없다

| | |
|---|---|
| **발견** | 2026-09-23 (M2, 서류 파이프라인) |
| **문제** | v1.0 §5.4 는 "악성코드 검사 완료 전 QUARANTINED, 통과 후 AVAILABLE" 을 규정한다. 그런데 **검사 워커가 결과를 보고할 경로가 계약에 없다.** 그러면 서류는 영원히 QUARANTINED 에 머물고, 접수 확정이 AVAILABLE 기준이므로 필수서류가 있는 전형은 접수가 끝나지 않는다 |
| **판정** | 내부 API 를 추가한다 — `GET /internal/v1/documents/pending-scan`, `POST /internal/v1/documents/{id}/scan-result` |
| **왜 워커가 DB 를 직접 고치지 않는가** | 서류 상태의 원장은 대학 DB 이고 상태 전이 규칙은 `admission-api` 한 곳에만 있어야 한다. 워커가 DB 를 직접 쓰면 규칙이 두 곳에 생긴다 (ADR-0004) |
| **노션 반영** | ✅ §03 첨부 yaml v1.2.0 교체 (2026-09-27) · ✅ §03 본문 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-21. config_version 은 단독 승인을 DB 가 막지 않는다

| | |
|---|---|
| **발견** | 2026-09-23 (M3 착수) |
| **문제** | `deadline_policy` 는 `approved_by_1/2 NOT NULL` + `CHECK (approved_by_1 <> approved_by_2)` 로 단독 승인을 DB 가 막는다. **`config_version` 은 둘 다 nullable 이고 CHECK 도 없다.** 승인자 0명으로도 `status='ACTIVE'` 가 될 수 있다 |
| **왜 중대한가** | v1.1 §A14 는 **마감시각·전형료·모집단위·지원자격·PG 설정**에 2인 승인을 요구한다. 그것들이 전부 `config_json` 에 들어간다. §01 E 의 핵심 인수기준 "단독 운영자 1명으로 마감시간 변경 불가" 가 Config 경로로 우회된다 |
| **잠정 조치** | 애플리케이션에서 강제한다 — 서로 다른 두 승인자 + 작성자는 승인자가 될 수 없음. 하지만 **코드는 우회 가능하고 DB 는 아니다.** deadline_policy 와 같은 수준이 되려면 제약이 필요하다 |
| **필요한 DDL** | `CHECK (status <> 'ACTIVE' OR (approved_by_1 IS NOT NULL AND approved_by_2 IS NOT NULL AND approved_by_1 <> approved_by_2))` |
| **조치 (2026-09-23)** | `infra/db/migrations/0002_integrity_constraints.sql` 로 제약을 추가했다. **0001 은 손대지 않았다** — 첨부 DDL 과 바이트가 같아야 하므로, 테이블을 다시 정의하지 않고 `ALTER TABLE ... ADD CONSTRAINT` 만 덧붙였다. 원본은 여전히 노션 하나뿐이고, 0002 는 "노션에 아직 반영되지 않은 차이" 를 파일 하나로 모아 보여주는 역할을 한다 |
| **함께 발견** | 검증 중에 같은 뿌리의 구멍 셋을 더 찾았다 — ① 작성자가 자기 변경을 승인할 수 있었다(§A14 위반) ② 한 전형에 `ACTIVE` 설정이 둘 이상 가능했다(적용 양식이 조회 순서에 달림) ③ `deadline_policy` 는 `DRAFT:` 접두사 상태로도 `activated_at` 을 채울 수 있었다(D-23 의 부작용). 셋 다 0002 에서 막았다 |
| **검증** | `infra/db/verify-constraints.sql` 8·9·10 — 승인 0명 활성화 / 작성자 자기승인 / 전형당 ACTIVE 중복이 전부 DB 에서 거부됨 |
| **노션 반영** | ✅ §02 첨부 DDL v1.2 교체 · 0002 삭제 (2026-09-27). **반영 전까지 마이그레이션이 두 파일로 나뉜다** · ✅ §02 본문 "v1.1 구현 반영" 절 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-22. Deadline Policy 에 활성화 API 가 없다

| | |
|---|---|
| **발견** | 2026-09-23 (M3) |
| **충돌** | DDL `deadline_policy.activated_at` 이 존재하고 v1.1 §A2 는 "정책은 입학처 **2인 승인 후 활성화**한다"고 규정한다. 그런데 OpenAPI 에는 `POST /admin/v1/deadline-policies` 와 `.../approve` 만 있고 **activate 가 없다.** Config 쪽에는 activate 가 있다 |
| **문제** | 승인과 활성화를 분리한 이유는 §A14 의 "활성화 예약시간" 때문이다. 승인 즉시 적용되면 마감정책이 의도치 않은 시점에 바뀐다 |
| **판정** | `POST /admin/v1/deadline-policies/{policyId}/activate` 를 추가한다. Config 와 대칭을 맞춘다 |
| **노션 반영** | ✅ §03 첨부 yaml v1.2.0 교체 (2026-09-27) · ✅ §03 본문 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-23. deadline_policy 에 초안 상태를 표현할 컬럼이 없다

| | |
|---|---|
| **발견** | 2026-09-23 (M3, Deadline Policy Engine 구현 중) |
| **문제** | §A2 는 "정책은 입학처 2인 승인 후 활성화한다" 고 규정한다. 승인 **전** 상태가 존재한다는 뜻이다. 그런데 DDL 은 `approved_by_1/2 NOT NULL`, `approved_at NOT NULL` 이고 **status 컬럼이 없다.** 초안을 표현할 자리가 없다 |
| **대조** | `config_version` 에는 `status CHECK (DRAFT/APPROVED/ACTIVE/RETIRED)` 가 있다. 두 테이블이 같은 수명주기를 갖는데 모델이 다르다 |
| **잠정 조치** | 승인 전에는 승인자 컬럼에 `DRAFT:` 접두사를 넣어 구분한다. **좋은 방법이 아니다** — 문자열 규약이라 DB 가 강제하지 못하고, 조회할 때마다 접두사를 벗겨야 한다 |
| **추가 결함** | 같은 테이블에 **`created_at` 도 없다.** 다른 모든 테이블에는 있다. 생성 순서를 알 수 없어 이력 조회를 승인 시각으로 정렬해야 한다. 승인 전 초안은 정렬 기준이 아예 없다 |
| **제안** | `deadline_policy` 에도 `status varchar(24) CHECK (status IN ('DRAFT','APPROVED','ACTIVE','RETIRED'))` 와 `created_at timestamptz NOT NULL DEFAULT now()` 를 두고 승인자 컬럼을 nullable 로 바꾼다. 대신 D-21 처럼 `CHECK (status <> 'ACTIVE' OR (승인자 둘 다 있고 서로 다름))` 로 막는다 |
| **노션 반영** | ✅ §02 첨부 DDL v1.2 교체 (2026-09-27) (status·created_by·created_at, 승인자 nullable) |
| **결정 (2026-09-27)** | **채택** — `status`·`created_at` 추가, 승인자 nullable + ACTIVE 는 서로 다른 두 승인자 CHECK. `DRAFT:` 접두사는 DB 가 강제하지 못한다. D-29 와 같은 §02 첨부 DDL 교체 때 함께 반영 |
| **저장소 반영 (2026-09-27)** | ✅ `0006_deadline_policy_status.sql` — 상태는 **DRAFT → APPROVED → ACTIVATED** 셋이다. 제안의 ACTIVE/RETIRED 대신 이렇게 둔 이유: 마감 정책의 효력은 `activated_at` 순서로 정해지고(예약 활성화), "지금 적용 중" 을 행에 적으면 예약 시각마다 누군가 고쳐야 한다. `created_by` 도 컬럼으로 올려 **작성자 자기승인을 DB 가 막는다**(D-21 과 같은 수준). 승인은 조건부 UPDATE 로 바꿔 동시 승인에서 한쪽이 사라지지 않게 했다(늦은 쪽 409). `DRAFT:` 접두사 제거 · `db:verify` 20 · 시험 2종 |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-24. Evidence Package 조회에 사유 파라미터가 없다

| | |
|---|---|
| **발견** | 2026-09-23 (M3, Evidence Package 구현) |
| **문제** | v1.0 §8.3 은 "민감정보 조회는 **목적·사유 입력 및 별도 Audit**" 를 요구한다. §B16 도 운영자 보정에 reason/ticket 을 요구한다. 그런데 canonical OpenAPI 의 `getEvidencePackage` 는 `applicationId` 만 받는다. **사유 없이 열람할 수 있다** |
| **왜 중요한가** | Evidence Package 는 한 지원자의 접수 과정 전체를 담는다. 사유 없이 누구나 열어볼 수 있으면 §09 Information Disclosure 의 "운영자 과권한" 이 그대로 열린다 |
| **판정** | `?reason=` 을 필수로 받는다. 비어 있으면 400. 열람 사실을 `ADMIN_VIEWED_PII` 감사 이벤트로 남긴다 |
| **노션 반영** | ✅ §03 첨부 yaml v1.2.0 교체(reason) (2026-09-27) · ✅ §03 본문 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-25. reconciliation_exception 에 중복 방지 제약이 없다

| | |
|---|---|
| **발견** | 2026-09-23 (M3, Reconciliation Center 구현) |
| **문제** | `reconciliation_exception` 에 `(application_id, exception_type)` UNIQUE 가 없다. §B18 의 D+1 대조는 **주기적으로 돈다.** 같은 불일치가 매 실행마다 새 행으로 쌓인다 |
| **결과** | 하나의 사고가 큐에 수십 건으로 보인다. 운영자가 "몇 건이 남았는가" 를 판단할 수 없고, 해결해도 다음 실행에 다시 생긴다 |
| **잠정 조치** | 삽입 전에 같은 종류의 OPEN/MANUAL_REVIEW 건이 있는지 조회해 건너뛴다. **경쟁 상태에서는 여전히 중복이 가능하다** — 두 인스턴스가 동시에 대조하면 둘 다 "없음" 을 보고 둘 다 넣는다 |
| **조치 (2026-09-23)** | 0002 마이그레이션에 부분 유니크 인덱스 `uq_recon_open_per_type` 을 추가했다. 동시에 서비스의 조회-후-삽입을 `INSERT ... ON CONFLICT DO NOTHING` 한 방으로 바꿨다. 판정을 코드가 아니라 인덱스가 한다 (§B3 의 "읽고-검사하고-쓰기 금지" 와 같은 원칙) |
| **범위** | 인덱스는 `OPEN`·`MANUAL_REVIEW` 에만 건다. **해소된 뒤의 재발은 새 사건이라 다시 열려야 한다.** 전체 UNIQUE 로 걸면 두 번째 사고를 놓친다 |
| **검증** | `verify-constraints.sql` 11 (중복 거부) 과 11b (해소 후 재발 허용) |
| **노션 반영** | ✅ §02 첨부 DDL v1.2 교체 (2026-09-27) · ✅ §02 본문 "v1.1 구현 반영" 절 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-26. Reconciliation 수동 실행 경로가 계약에 없다

| | |
|---|---|
| **발견** | 2026-09-23 (M3) |
| **문제** | §B18 은 "D+1 에 자동 대조" 를 규정하고 OpenAPI 는 목록 조회와 해소만 제공한다. **대조를 지금 돌리는 경로가 없다** |
| **왜 필요한가** | 장애 대응 중에는 다음 배치를 기다릴 수 없다. SEV1 런북의 `Reconciliation` 단계(§14.3)는 즉시 실행을 전제로 한다. 배치 주기가 하루면 그 사이 운영자는 상태를 확인할 방법이 없다 |
| **판정** | `POST /admin/v1/reconciliation/run` 추가 |
| **노션 반영** | ✅ §03 첨부 yaml v1.2.0 교체 (2026-09-27) · ✅ §03 본문 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-27. 중앙 요약에 지원자 참조가 없어 Dashboard 가 전체를 돌려준다 🔴

| | |
|---|---|
| **발견** | 2026-09-23 (프로덕션 점검) |
| **문제** | v1.1 §10 §9 는 "내 원서" Dashboard 를 규정한다. 그런데 `application_summary` 에는 지원자를 가리키는 컬럼이 없다. 구현은 `applicantToken` 파라미터를 받아놓고 **무시한 채 전체 100건을 돌려주고 있었다** |
| **왜 중대한가** | 인증이 붙어도 이 경로는 막히지 않는다. 로그인한 **누구나** 다른 지원자의 대학·전형·모집단위·접수번호·접수시각을 본다. 조회가 아니라 유출이다 |
| **설계 긴장** | §A3 은 중앙에 최소 정보만 두라고 한다. 그래서 지원자 식별자를 안 보낸 것이 의도적이었을 수 있다. 하지만 식별자가 없으면 "내 원서" 기능 자체가 성립하지 않는다. **둘 중 하나는 포기해야 한다** |
| **판정** | `sha256(subject_token)` 을 `subjectRef` 로 보낸다. ① 원문이 아니라 해시라 요약 테이블이 Vault 와 직접 조인되지 않는다 ② 대학별 소금을 섞지 않아 같은 사람이면 대학이 달라도 같은 값이다 — 그게 통합 조회의 전제다 ③ CloudEvents optional 필드 추가라 §04 Schema Evolution 상 호환 변경이다 |
| **함께 결정** | `applicantToken` 없는 요청은 400 이다. 빈 목록을 주면 "접수된 원서가 없다"로 읽혀 지원자가 재접수를 시도한다 |
| **저장소 반영** | ✅ `packages/contracts/src/events.ts` (optional `subjectRef`) · `infra/db/central/0001_init.sql` (`subject_ref` + 인덱스) · sync-gateway upsert · dashboard 필터 |
| **노션 반영** | ✅ §04 이벤트 스키마·§10 §9 Dashboard 계약에 `subjectRef`(목적 키 HMAC) 반영 — 가명 참조 유지 (2026-09-27 확정) (2026-09-27) |
| **결정 (2026-09-27)** | **둔다 — 현행 유지.** 통합 조회는 참조 없이 성립하지 않고, 참조는 목적 키 HMAC(D-39)이라 Vault 와 조인되지 않는다. 현행 복수지원 위반 검색은 대교협이 대학 자료를 직접 받아 대조하는 구조라, 중앙에 가명 참조만 두는 쪽이 집중도가 낮다. §01 A12 에 적은 형식 그대로 간다 |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-28. 지원자 API 에 소유권 검사가 없었다 🟢

| | |
|---|---|
| **발견** | 2026-09-23 (프로덕션 점검) |
| **문제** | 조회·수정 경로 전부가 `applicationId` 만으로 동작했다. `x-applicant-id` 는 **감사 기록의 actor 로만** 쓰였고 인가에는 전혀 쓰이지 않았다. 헤더를 바꾸면 남의 원서를 읽고, 자기소개서를 덮어쓰고, 서류를 지우고, 최종접수까지 할 수 있었다 |
| **영향 경로** | `GET /applications/{id}` · `PATCH /applications/{id}` · `POST /{id}/validate` · `GET /{id}/form-schema` · `GET /payments/{id}` · `POST /payments/{id}/verify` · `GET /{id}/submission` · `GET /submissions/{id}/receipt` · `POST /documents/{id}/complete` · `DELETE /documents/{id}` |
| **왜 계약만 봐서는 안 잡히나** | OpenAPI 는 `security: [{ oidc: [] }]` 로 "인증"을 규정하지만 **인가는 규정하지 않는다.** 인증만 붙이면 로그인한 지원자 전원이 서로의 원서를 볼 수 있다. 계약이 맞아도 제품이 틀릴 수 있는 자리다 |
| **판정** | 자원마다 소유자를 확인한다. 없는 자원과 남의 자원을 **같은 응답**으로 돌려준다 — 구분해 주면 식별자를 훑어 유효한 원서를 찾아낼 수 있다 |
| **저장소 반영** | ✅ `common/identity/ownership.service.ts` + 전 경로 적용 · 통합 테스트 6종 |
| **노션 반영** | ✅ §09 STRIDE Information Disclosure (2026-09-27) · ✅ §03 소유권 규칙 (2026-09-27) |
| **재발견 (2026-09-27)** | `GET /applications/{id}/self-check` 가 **빠져 있었다.** 원서 ID 만 알면 남의 접수번호·결제 상태·시도 이력이 보였다. 소유권 검사를 붙였고, 같은 누락이 다시 생기지 않게 `ownership-coverage.test.ts` 가 컨트롤러를 훑어 `/api/v1` 아래 지원자 자원 식별자를 받는 핸들러가 `this.ownership.assert…` 를 부르지 않으면 실패한다(검사를 빼면 이 경로를 정확히 잡는 것까지 확인). 함께 고친 것: 없는·남의 자원 응답이 계약(404)과 달리 **400 VALIDATION_FAILED** 였다 — 구분은 막았지만 계약 위반이라 404 NOT_FOUND 로 맞췄다 |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-29. 취소한 원서가 재지원을 영구히 막았다 🔴

| | |
|---|---|
| **발견** | 2026-09-23 (D-7 구현 중 E2E 에서 드러남) |
| **문제** | 자연키 `UNIQUE (cycle_id, applicant_id, admission_type_id, department_id)` 에 상태 조건이 없다. 그래서 **취소한 지원자가 마감 전인데도 같은 전형에 다시 지원할 수 없었다.** 재지원 요청이 DB 제약에서 막힌다 |
| **왜 놓쳤나** | D-12 에서 이 자연키를 "생성 멱등성의 근거" 로 채택했다. 그때는 취소가 없었다. 취소를 붙이자 같은 제약이 다른 뜻이 됐다 — **기능을 더할 때 기존 제약의 의미가 바뀌는 자리** |
| **판정** | 지키려던 규칙은 "같은 지원자가 같은 전형·모집단위에 두 번 넣을 수 없다" 이고, 그건 **유효한 원서** 사이에서만 의미가 있다. 취소된 원서는 유효하지 않다. 부분 유니크 인덱스로 `WHERE status <> 'CANCELLED'` 를 건다 |
| **`EXPIRED` 는 제외하지 않는다** | 마감이 지난 것이라 어차피 재지원이 불가능하다. 범위를 넓힐수록 원래 보장에서 멀어진다 |
| **⚠️ 주의** | 이것은 canonical DDL 의 제약을 **약화**하는 변경이다. 다른 항목(D-21·D-25)처럼 덧붙이는 것이 아니다. 노션 확인이 특히 필요하다 |
| **저장소 반영** | ✅ `0002_integrity_constraints.sql` · `application.repository.ts` 의 `ON CONFLICT` 와 조회 조건 |
| **노션 반영** | ✅ §02 첨부 DDL v1.2 교체 (2026-09-27) (자연키 `(cycle_id, applicant_id, admission_type_id) WHERE status <> 'CANCELLED'`) |
| **결정 (2026-09-27)** | **채택하되 키를 고친다.** 취소 원서 제외는 맞다(결제 전 삭제·재작성은 현행 관행). 그러나 키에 `department_id` 가 있어 **같은 전형에 모집단위만 다른 유효 원서를 둘 가질 수 있었다** — 대학입학전형기본사항 "하나의 전형에서는 하나의 모집단위에만 지원할 수 있음" 위반. 키를 `(cycle_id, applicant_id, admission_type_id) WHERE status <> 'CANCELLED'` 로 바꾼다. 다른 모집단위로 생성·전형 변경 시 409 `ONE_DEPARTMENT_PER_ADMISSION_TYPE` |
| **저장소 반영 (2026-09-27)** | ✅ `0005_one_department_per_admission_type.sql` · `application.repository.ts` · `db:verify` 19 · `natural-key.integration.test.ts` 4종 |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-30. `system_config` 가 canonical DDL 에 없다

| | |
|---|---|
| **발견** | 2026-09-23 (T-M3-02 Freeze 설계 중) |
| **충돌** | `infra/db/README.md` 의 엔티티 목록(v1.0 §6 + v1.1 §02 ERD 기준)에는 `SystemConfig` 가 있다. **첨부 DDL 21개 테이블에는 없다** |
| **영향** | 운영 스위치를 담을 자리가 없다. Freeze 해제 기록, 기능 토글, 점검 모드 같은 것을 둘 곳이 마땅치 않다 |
| **이번에 한 선택** | Freeze 를 **저장소 없이** 만들었다. 마감 정책의 마감시각에서 구간을 계산하고, 해제 경로를 두지 않는다. 필요해 보이는 해제 상황(마감 연장)은 `deadline_policy` 의 일이라 이 잠금에 걸리지 않는다 |
| **판정** | 지금은 필요 없다. 다만 **문서와 DDL 이 어긋나 있는 것은 사실**이므로 둘 중 하나를 맞춰야 한다 — 테이블을 추가하거나, 엔티티 목록에서 빼거나 |
| **노션 반영** | ✅ §02 — ERD 에 `SystemConfig` 가 없음을 확인하고 첨부 설명에 명시 (2026-09-27) |
| **결정 (2026-09-27)** | **DDL 이 맞다 — ERD·엔티티 목록에서 `SystemConfig` 를 뺀다.** Freeze 는 저장소 없이 계산되고 운영 스위치를 쓰는 곳이 없다. 필요해지면 그때 테이블과 승인 절차를 함께 설계한다 |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-31. 활성화 시각을 애플리케이션 서버가 찍고 있었다

| | |
|---|---|
| **발견** | 2026-09-23 (문서 정리 중 테스트 flake 추적) |
| **문제** | 마감정책·설정을 **즉시 활성화**할 때 `activated_at` 을 애플리케이션의 `new Date()` 로 찍었다. 조회는 `activated_at <= now()` (DB 시계)로 한다. 두 시계가 다르면, 애플리케이션이 조금이라도 앞설 때 **방금 활성화한 정책이 잠시 "아직 적용 전"** 으로 보인다 |
| **어떻게 드러났나** | 통합 테스트가 10회 중 2~3회 실패했다. 마감 잠금(Freeze)이 걸려야 할 상황에서 "활성 마감정책 없음" 으로 판정돼 잠금이 통과됐다. 밀리초 단위 어긋남이었다 |
| **왜 중대한가** | v1.1 §A2 는 마감 판정을 **서버 시각**으로 한다고 규정한다. 그런데 "서버" 가 둘(애플리케이션·DB)이고 둘이 어긋날 수 있다는 것을 다루지 않았다. 마감 직전에는 그 밀리초가 사람의 접수다. Pod 가 여럿이면 각자 다른 시계를 갖는다 |
| **판정** | **시각의 권위는 DB 하나다.** 즉시 활성화는 `COALESCE($1::timestamptz, now())` 로 DB 가 찍는다. 예약 활성화는 지정 시각을 그대로 쓴다 — 미래 시각이라 경합이 없다 |
| **저장소 반영** | ✅ `deadline-policy.repository.ts` · `config-version.service.ts` |
| **노션 반영** | ✅ §A2 시각 권위는 DB (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-32. Circuit Breaker 가 열렸을 때의 규칙이 의존성마다 정해져 있지 않다

| | |
|---|---|
| **발견** | 2026-09-26 (T-M3-08 착수 전 §01 C8 재확인) |
| **문제** | §01 C8 은 "PG/중앙/문자/메일 등 외부 장애의 전파 차단" 한 줄이다. **끊긴 뒤 무엇을 하는지**가 없다. 그런데 의존성마다 답이 정반대다 |
| **판정** | 규칙을 의존성별로 정해 코드에 박았다 (`common/resilience/dependency-breakers.ts`) |
| | **중앙 Profile Vault** — fail-open. 빈 Snapshot 으로 원서 생성 계속 (D-18 유지) |
| | **PG 결제 확인** — **fail-open 금지.** CREATED·PENDING 은 `UNKNOWN` 으로 두고 Reconciliation(`PAYMENT_STATE_UNKNOWN_STALE`)에 맡긴다. 이미 결론 난 결제(FAILED 등)는 건드리지 않는다 |
| | **PG 결제 의도 생성** — 503. 결제창이 열리기 전이라 돈이 움직이지 않았고 남길 결제도 없다 |
| | **중앙 Sync Gateway (relay)** — 행을 집지 않는다. 재시도 횟수를 쓰지 않는다 (D-33) |
| | **접수 API (AV 워커 보고)** — 검사하지 않는다. 보고 못 할 판정에 CPU 를 쓰지 않는다 |
| **공통** | 연속 실패 기준(기본 5회), 30초 뒤 반열림 탐침 **1건**. 4xx 는 세지 않는다 — 상대가 살아서 거절한 것이다. 상태는 Pod 안에만 둔다 (공유 저장소는 새 의존성이 된다) |
| **readiness 와 분리** | Breaker 상태를 `readyz` 에 넣지 않는다. 중앙이 죽었다고 Pod 가 트래픽에서 빠지면 끊는 의미가 없다. 조회는 `GET /healthz/dependencies` |
| **계약 추가** | `getSyncStatus` 응답에 `circuit` (optional, §A16 상 호환) · `GET /healthz/dependencies` (probe 계열이라 OpenAPI 대상인지 확인 필요) |
| **저장소 반영** | ✅ `server-kit/circuit-breaker.ts` 외 |
| **노션 반영** | ✅ §03 첨부 yaml v1.2.0 교체 (2026-09-27) · ✅ §01 C8 의존성별 끊김 규칙 (2026-09-27) |
| **결정 (2026-09-27)** | **계약에 넣는다** — `Ops` 태그, 외부 Ingress 비노출. M4 Helm probe 가 이 경로에 기대므로 계약이 있어야 한다. 저장소 yaml v1.2.0 반영 |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-33. 중앙이 2분 반만 죽어도 Outbox 이벤트가 DEAD 로 떨어졌다 🟢

| | |
|---|---|
| **발견** | 2026-09-26 (T-M3-08 구현 중 relay 코드 검토) |
| **문제** | relay 는 실패마다 `attempt_count` 를 올리고 10회에 DEAD 로 보낸다. Backoff 가 attempt² × 500ms 라 누적 대기가 **약 142초**다. 중앙이 그보다 오래 죽으면 그동안 쌓인 이벤트가 **전부 DEAD** 가 된다. DEAD 는 사람이 다시 보내야 한다 |
| **충돌** | §B7 은 "중앙 장기장애 시 별도 spool" 을, relay 주석은 "중앙 장기 장애에도 Outbox 는 계속 쌓일 수 있어야 한다" 를 요구한다. 재시도 한도가 그 요구를 조용히 뒤집고 있었다 |
| **원인** | 재시도 횟수 하나가 두 가지를 섞어 셌다. "이 이벤트가 문제인가" 와 "중앙이 살아 있는가" |
| **판정** | **중앙 장애 중의 실패는 이벤트의 재시도 횟수를 쓰지 않는다.** 회로가 닫혀 있을 때의 실패만 센다 (이벤트 고유 문제일 수 있으므로). 열리면 행을 집지 않고, 이미 집은 행은 횟수 그대로 PENDING 으로 되돌린다 |
| **검증** | `relay.integration.test.ts` — 가짜 중앙을 끄고 탐침 3주기를 돌린 뒤 켰다. DEAD 0, 최대 attempt_count 1, 5건 전부 SENT |
| **남은 것** | 개발 DB 에 기존 DEAD 6건이 있다. 원인은 DB 에 남지 않아 이 결함 때문인지 단정할 수 없다. DEAD 사유를 컬럼으로 남기는 것은 DDL 변경이라 별도 판단 |
| **저장소 반영** | ✅ `apps/event-relay/src/relay.service.ts` |
| **노션 반영** | ✅ §B7 재시도 한도는 이벤트 단위 실패만 센다 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-34. Autonomous Mode 의 구성요소가 서로 다른 단계에 걸쳐 있다

| | |
|---|---|
| **발견** | 2026-09-26 (T-M3-06 착수 전 순서 검토) |
| **문제** | §01 A1 은 Autonomous Mode 의 기능으로 Local Policy Snapshot · Local JWKS Cache · Offline Event Spool · Central Dependency Health Gate · 운영배너/Sync Lag 를 한 묶음으로 적는다. 그런데 이들이 기대는 것이 서로 다른 단계에 있다 |
| **판정** | 인증과 무관한 것만 T-M3-06 에서 한다. |
| | **Health Gate · 배너 · Sync Lag 경보** — ✅ 이번에 |
| | **Offline Event Spool** — ✅ T-M3-08 (D-33). 장기 적체 **용량**(파티션·아카이브)은 DDL 변경이라 M4 §B7 |
| | **Local JWKS Cache** — ⏭ **T-M5-02**. 지금은 `AUTH_MODE=dev-headers` 라 검증할 토큰도 발급자도 없다. 먼저 만들면 형식을 추측해 짓게 된다 |
| | **서명된 Local Policy Snapshot** — ⏭ **T-M3-15**. 정책·설정은 이미 대학 DB 에 있고 2인 승인·`policy_hash` 가 남는다. 빠진 것은 **서명**이고, 그건 signed config version 과 같은 일이다 |
| **시간 기준도 둘이다** | A1 해결은 "최소 **24시간** 단절", §E 인수기준은 "**2시간** 단절" 이다. 기능 자체는 시간과 무관하게 동작하므로(Demo Gate 5), 어느 쪽을 인수기준으로 할지는 M4 장애 시험에서 정한다 |
| **계약 추가** | `GET /api/v1/meta/operating-mode` — 공개 조회, 개인정보·운영정보 없음. 메모리의 마지막 확인 결과만 돌려준다 |
| **저장소 반영** | ✅ `modules/operating-mode/` · 프론트 `OperatingModeBanner` |
| **노션 반영** | ✅ §03 첨부 yaml v1.2.0 교체(operating-mode) (2026-09-27) · ✅ §03 본문 (2026-09-27) · ✅ §01 A1 단계 표기·단절 시간 기준(24시간 설계 목표/2시간 인수시험) (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-35. 마감·설정을 "누가 언제 왜 적용했는지" 담을 자리가 DDL 에 없다

| | |
|---|---|
| **발견** | 2026-09-26 (T-M3-14·15 착수 중) |
| **문제** | §B17 은 연장 시 "누가 언제 왜" 가 불변 기록으로 남기를 요구한다. 그런데 `deadline_policy` · `config_version` 에는 **적용한 사람도, 사유도, 서명도** 없다. `activated_at` 하나뿐이다. 되돌리기는 같은 행의 `activated_at` 을 덮어써 **앞선 적용의 흔적을 지운다.** 되돌리기 사유는 로그에만 있었다 |
| **판정** | 적용 **사건**을 별도 테이블 `activation_record` 로 남긴다 (0003). canonical 테이블은 고치지 않고 새 테이블만 더한다. Ed25519 서명 · 추가만 가능(트리거) · 연장은 결정 문서번호 CHECK |
| **함께 정한 규칙** | 한 번 적용된 마감 정책은 다시 적용하지 않는다(옛 마감으로 돌아가는 뒷문). 적용 시각에 이미 지난 마감은 적용하지 않는다(소급 마감). 연장은 적용 중인 정책을 기준으로만, 기준이 바뀌면 409 |
| **테스트 영향** | 적용 이력이 있는 전형은 지울 수 없다 — 맞는 성질이다. 통합 테스트는 전형을 지우지 않고 `ARCHIVED` 로 닫는다 |
| **남은 것** | ① 키 교체 시 옛 기록을 검증할 **검증 키 목록**이 없다 (지금은 `UNKNOWN_KEY` 로 표시) ② 서명 키 보관은 M5 Vault ③ 운영자 신원 증명은 T-M5-10 |
| **계약 추가** | `POST /admin/v1/deadline-policies/extensions` · `GET /admin/v1/activations` · `GET /api/v1/meta/signing-keys` · activate 응답의 `activation` |
| **저장소 반영** | ✅ `0003_signed_activation.sql` · `modules/activation/` · 마감·설정 서비스 · Evidence |
| **노션 반영** | ✅ §02 첨부 DDL v1.2 교체 (2026-09-27) (`activation_record`) · ✅ §03 첨부 yaml v1.2.0 교체(연장·적용 이력·공개키) (2026-09-27) · ✅ §03 본문 (2026-09-27) · ✅ §B17 연장 규칙 (2026-09-27) · ✅ §02 본문·ERD (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-36. 원서에 딸리지 않은 감사 이벤트는 체인이 아니었다 🔴

| | |
|---|---|
| **발견** | 2026-09-26 (T-M3-15 구현 중 운영자 행위를 감사에 올리다) |
| **문제** | `AuditService.lastHash()` 는 `applicationId` 가 없으면 **매번 GENESIS** 를 돌려줬다. 원서 없는 이벤트는 서로 이어지지 않았고, 하나를 지워도 드러나지 않았다. 게다가 `ADMIN_CHANGED_CONFIG` 는 정의만 있고 **어디서도 쓰이지 않았다** — 마감·설정 변경이 감사 체인에 없었다 |
| **왜 놓쳤나** | 원서 없는 이벤트가 0건이었다. 체인 검증은 원서 단위로만 돌았다 |
| **판정** | 원서 없는 이벤트는 **시스템 체인** 하나로 잇는다. 동시 기록은 advisory lock 으로 줄 세우고, 직전 이벤트보다 시각이 늦게 찍히도록 보정한다(같은 밀리초면 순서가 뒤섞여 멀쩡한 체인이 깨진 것으로 보인다). `verifySystemChain()` 추가, 적용 이력 조회에 결과를 싣는다 |
| **저장소 반영** | ✅ `audit.service.ts` |
| **노션 반영** | ✅ v1.0 §9 시스템 체인 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-37. 깨진 UTF-8 본문이 성공 응답과 함께 저장됐다 🔴

| | |
|---|---|
| **발견** | 2026-09-26 (T-M3-14 E2E 중) |
| **문제** | 기본 JSON 파서가 잘못된 UTF-8 바이트를 U+FFFD(�)로 바꿔 **그대로 받아들였다.** Windows 셸에서 CP949 로 보낸 연장 요청의 결정 문서번호가 `����ó-2026-117` 로 저장됐고, 그 값이 **서명된 활성화 기록에 영구히 남았다** (추가만 가능하므로 고칠 수 없다 — 개발 DB 의 보관된 테스트 전형에 있다) |
| **영향** | 지원자 이름·주소·자기소개도 같은 경로다. 지원자는 저장 성공을 보고 넘어가고, 깨진 값으로 접수된다 |
| **판정** | UTF-8 이 아니면 **400** 으로 거절한다 (`TextDecoder` fatal). 500 이면 서버 고장으로 알고 같은 것을 또 보낸다. 잘못된 JSON 도 400 `VALIDATION_FAILED` 로 정리했다 (전에는 status 400 에 code `INTERNAL`) |
| **구현 주의** | Nest 가 기동 시 자기 JSON 파서를 따로 올린다. `bodyParser: false` 로 끄지 않으면 기본 동작이 되살아난다 |
| **저장소 반영** | ✅ `common/http/strict-json.ts` · `main.ts` |
| **노션 반영** | ✅ §03 첨부 yaml v1.2.0 교체(공통 오류) (2026-09-27) · ✅ §03 공통 요구 (2026-09-27) · ✅ §06 입력 검증 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-38. Retention Matrix 의 하한값이 설계서에 없다

| | |
|---|---|
| **발견** | 2026-09-26 (T-M3-10 착수 전 노션 재확인) |
| **문제** | §A15 는 "법정·기관 기준보다 짧게 설정 불가" 를 요구하는데, 설계서가 숫자로 준 기준은 **관리자 접속기록 2년**(v1.0 §2.2) 하나다. 원서 데이터는 "각 대학 개인정보처리방침·입시업무 규정에 따라 별도 Retention Matrix" (v1.0 §9) 라고만 하고, 그 매트릭스는 노션 어디에도 없다 |
| **판정** | **숫자를 지어내지 않는다.** 근거 있는 2년만 `LEGAL` 하한으로 두고, 나머지는 `INSTITUTION` — 플랫폼 하한 없이 대학이 **반드시 명시**. 감사·적용 기록은 `IMMUTABLE` (기간 지정 자체 거절). 틀린 숫자를 박으면 플랫폼이 법보다 짧은 보존을 강제하게 된다 |
| **정합성 규칙** | 동의 기록 ≥ 그 동의로 처리한 개인정보 · 결제 기록 ≥ 접수 원서 (증적 묶음) |
| **파기 방식** | 원서 행은 지울 수 없다 — `audit_event.application_id` FK 가 막고, 억지로 지우면 `consent_record` 가 CASCADE 로 사라진다 (DB 에서 확인). 그래서 원서·신원·결제·동의는 **내용 제거**, 서류는 파일만 삭제하고 해시 유지 |
| **실행** | 파기 **계획**만 보여준다 (`GET /admin/v1/retention/plan`). 실행은 WORM 이관(M5) · 계획 승인 절차와 함께 |
| **필요한 결정** | ① 개인정보 담당이 원서·신원·서류·결제·동의의 법정·기관 하한을 정해 준다 (정해지면 해당 항목을 `LEGAL` 로) ② 파기 실행을 누가 승인하는가 |
| **계약 추가** | `GET /admin/v1/retention/matrix` · `GET /admin/v1/retention/plan` · Config `retention` 섹션 |
| **저장소 반영** | ✅ `contracts/retention.ts` · `modules/retention/` · Config 검증·Diff |
| **노션 반영** | ✅ v1.0 §9 에 Retention Matrix 표 (2026-09-27) · ✅ §02 파기 = 내용 제거 (2026-09-27) |
| **결정 (2026-09-27)** | **접수 원서 10년 하한(LEGAL 3650).** 대학입학전형기본사항이 입시 기록물을 「공공기록물 관리에 관한 법률」·국가기록원 「대학 기록물 보존기간 책정기준 가이드」(2021)에 따라 보존하라고 하고, 가이드의 '입시관리업무' 단위과제가 **10년**이다. 결제·동의 기록은 기존 정합성 규칙으로 10년을 따라간다. 관리자 접속기록 2년 확인 — 「개인정보의 안전성 확보조치 기준」 제8조: 1년 이상, 고유식별정보·민감정보를 처리하거나 5만 명 이상이면 2년 이상 |
| **남긴 것** | 서류·신원은 접수·미접수가 한 항목이다. 여기에 10년을 걸면 미접수자 정보까지 10년 붙잡힌다(개인정보보호법 제21조 — 목적 달성 시 지체 없이 파기). **항목을 접수·미접수로 나눈 뒤** 접수분에 10년을 건다 |
| **저장소 반영 (2026-09-27)** | ✅ `contracts/retention.ts` · 시험 2종 |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27). 서류·신원 항목의 접수·미접수 분리는 파기 실행(M5)과 함께 |

---

## D-39. 중앙의 지원자 참조가 Vault 와 조인됐고, 대학 내부 UUID 가 중앙에 갔다 🔴

| | |
|---|---|
| **발견** | 2026-09-26 (T-M3-09 착수 전 식별자 추적) |
| **문제 ①** | D-27 의 `subjectRef = sha256(subject_token)`. 중앙 Vault 는 `subject_token` 을 기본키로 갖는다 — 키 없는 해시는 누구나 다시 계산하므로 Vault 를 읽으면 요약과 그대로 조인된다. 주석의 "Vault 와 직접 조인되지 않으면서" 는 사실이 아니었다 |
| **문제 ②** | 원서 생성 시 Vault 로 보내는 `applicationRef` 가 `${cycleId}:${applicantId}` — **대학 내부 지원자 UUID 원문**이다. 중앙 DDL 주석은 "opaque id 를 받는다" 였다. §A12 "대학 원본 식별자와 중앙 토큰 매핑 분리" 위반 |
| **문제 ③** | 대시보드가 `applicantToken` 을 **URL 쿼리**로 받았다. 프록시·접근 로그·브라우저 기록에 식별자가 남는다 (§B8) |
| **판정** | ① 목적 키 HMAC `<keyId>.<base64url(HMAC("DASHBOARD"|token))>` — Vault 는 키를 갖지 않는다. 키 목록으로 교체 지원 ② 대학 소금으로 만든 opaque 값 ③ `x-subject-token` 헤더, 쿼리는 400 |
| **D-27 과의 관계** | 가명 참조를 둔다는 결정은 유지했다. 참조를 만드는 방법만 바꿨다. D-27 이 "두지 않는다" 로 결론 나도 제거는 똑같이 쉽다 |
| **남은 것** | 키 보관(M5 Vault) · 대학·중앙 키 배포 절차 · 중복지원 검증(v1.0 §6.2)이 필요해지면 별도 키의 `DEDUP` 목적 |
| **저장소 반영** | ✅ `server-kit/purpose-ref.ts` · finalization · application.repository · central dashboard · frontend |
| **노션 반영** | ✅ §04 `subjectRef` 형식 (D-27: 둔다) (2026-09-27) · ✅ §03 첨부 yaml v1.2.0 교체(대시보드 헤더) (2026-09-27) · ✅ §03 본문 (2026-09-27) · ✅ §A12 참조 형식·키 교체 규칙 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-40. 결제 자동 정합화가 없다 — 콜백도, 재확인도, 대조 스케줄도 🔴

| | |
|---|---|
| **발견** | 2026-09-26 (M3 종료 체크리스트를 코드로 확인하다) |
| **문제** | §A4 는 "Callback + Provider Polling 이중 확인" 과 "D+1 4-way Reconciliation" 을, §01 E 는 "PG Callback 30분 지연: 자동 정합화" 를 요구한다. 코드에는 ① PG 콜백 엔드포인트가 **없고** ② PENDING·UNKNOWN 결제를 다시 확인하는 주기 작업이 **없고** ③ 대조는 **사람이 눌러야만** 돈다 |
| **영향** | 지원자가 결제 직후 창을 닫으면 그 결제는 누군가 다시 확인할 때까지 PENDING 으로 남는다. 돈은 나갔는데 접수는 멈춘 상태가 저절로 풀리지 않는다 |
| **왜 놓쳤나** | 대조 기능(T-M3-04)을 "검사할 수 있다" 로 완료 처리했다. "저절로 돈다" 는 별개의 인수기준이었다 |
| **판정** | 결제 확인 워커(Backoff · PG Breaker) + 서명 검증·멱등 콜백(값은 믿지 않고 재조회) + 대조 스케줄(1시간·D+1, advisory lock). **결제가 확인돼도 자동 Finalize 는 하지 않는다** — 제출은 지원자의 의사 표시다 |
| **저장소 반영** | ✅ 2026-09-27 — `POST /api/v1/payments/callbacks/:provider`(서명 · 멱등 · PG 재조회 · Idempotency-Key 제외) · `PaymentRecheckWorker`(PENDING·UNKNOWN, Backoff 30초→30분, 48시간) · `ReconciliationScheduler`(1시간·48시간) · 둘 다 세션 advisory lock · 시험 13건. 30분 지연 시간 시험은 T-M4-34 |
| **노션 반영** | ✅ §03 첨부 yaml v1.2.0 교체(콜백) (2026-09-27) · ✅ §03 본문 (2026-09-27) · ✅ §A4·§B4 "자동 Finalize 하지 않음" (2026-09-27) — **D-42 가 대체, 다시 고친다** |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-41. 운영계정으로 감사 기록을 지울 수 있다 🟢

| | |
|---|---|
| **발견** | 2026-09-26 (M3 종료 체크리스트를 코드로 확인하다) |
| **문제** | `audit_event` 에 추가 전용 보호가 없고(활성화 기록에는 있다), 애플리케이션이 **슈퍼유저 역할 하나**로 DB 에 붙는다. 앱이든 운영자든 같은 권한으로 감사 기록을 지울 수 있다. 통합 테스트 4개 파일이 실제로 `DELETE FROM audit_event` 로 정리하고 있다 — 그게 된다는 것 자체가 증거다 |
| **요구** | v1.0 §9 "감사로그 삭제·수정 권한을 운영자에게 부여하지 않음" · §01 E "운영계정으로 Audit 삭제 불가" · §B16 |
| **판정** | 역할 분리(`kadmission_app` 은 감사·적용 기록에 INSERT·SELECT 만) + `audit_event` 추가 전용 트리거 + 테스트 정리 방식 변경 + `db:verify` 에 거부 확인. 물리 분리(WORM)는 M5 |
| **저장소 반영** | ✅ 2026-09-27 — `0004_db_roles_audit_append_only.sql`: `kadmission_app`(업무 테이블 DML · 감사·적용 기록은 **SELECT·INSERT 만** · TRUNCATE·DDL 없음) · `kadmission_migrator`(소유자) · `kadmission_auditor`(읽기). `audit_event` UPDATE·DELETE·TRUNCATE 트리거. admission-api · document-service · event-relay 가 앱 역할로 붙는다. 시험은 앱 역할로 돌고, 감사 기록 정리·변조 재현만 `test-support/break-glass.ts`(슈퍼유저 + `session_replication_role=replica`). `db:verify` 15~18 |
| **남은 것** | 슈퍼유저가 트리거를 일부러 끄는 것은 DB 안에서 막을 수 없다 → WORM·Object Lock(M5). 중앙 DB(`central`)도 아직 슈퍼유저 하나 — 같은 방식으로 M5 |
| **노션 반영** | ✅ §06 DB 역할 (2026-09-27) · ✅ §02 역할·트리거 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27). WORM 물리 분리는 M5 |

---

## D-42. 현행 원서접수는 "결제 = 접수" 인데 우리는 결제 뒤 제출을 따로 누른다

| | |
|---|---|
| **발견** | 2026-09-27 (결정 8건 근거 조사 — 현행 원서접수 관행 확인) |
| **충돌** | 현행 대입 원서접수는 **전형료 결제를 마치면 곧 접수 완료**다 — 결제 후 수정·취소 불가, 수험번호 부여. D-40 은 "결제가 확인돼도 자동 Finalize 하지 않는다 — 제출은 지원자의 의사 표시다" 로 정했다. README 의 지원자 여정은 "전형료 결제 및 **자동 접수 완료**" 라고 적혀 있어 D-40 과도 어긋난다 |
| **위험** | 현행에 익숙한 지원자는 결제 후 창을 닫는다. 그러면 원서는 **PAID 로 마감을 넘긴다** — 돈은 냈는데 접수는 안 된, 2026년 장애 구제 신청과 같은 종류의 분쟁이다. Self-check 가 "최종제출이 남았습니다" 를 보여줘도 지원자가 다시 열지 않으면 소용없다 |
| **제안** | "결제하기" 버튼을 **제출 의사 표시**로 정의하고(버튼 옆에 "결제가 확인되면 접수가 완료되며 이후 취소할 수 없습니다" 고지 — 현행 원서접수 안내와 같은 취지), 결제 확인(콜백·재확인 워커) 시 서버가 Finalize 한다. Finalize 검증(마감·필수 서류)에서 떨어지면 PAID 로 남기고 Self-check·대조가 드러낸다. 마감 판정 모드(`deadline_policy.mode` 의 `PAYMENT_APPROVED_BEFORE_DEADLINE`)와 함께 정해야 한다 |
| **결정 (2026-09-27)** | **자동 Finalize 한다.** "전형료 결제하고 접수" 가 제출 의사 표시다. 결제 전에 "결제가 확인되면 바로 접수, 이후 수정·취소 불가" 를 고지한다. 마감 판정 방식은 대학이 고른 `deadline_policy.mode` 그대로 — 접수 요청 시각은 결제 의도를 만든 시각이다 |
| **저장소 반영 (2026-09-27)** | ✅ ① **결제 전 확인** — 결제 의도는 지금 접수할 수 있는 원서에만 만든다(입력·필수 서류·상태·마감). 돈을 받은 뒤 "서류가 빠졌다" 를 알리면 환불 사건이 된다 ② **결제 확정 시 자동 접수** — 화면 verify·PG 콜백·재확인 워커 어느 쪽이든 처음 CONFIRMED 가 되면. 결제·접수 모듈이 서로 import 하지 않도록 접수 모듈이 기동할 때 결제 서비스에 훅을 건다. 실패하면 `FINALIZE_REQUESTED` REJECTED 감사 + 대조 `PAYMENT_CONFIRMED_WITHOUT_SUBMISSION` ③ **함께 고친 구멍** — Finalize 가 FINALIZED 만 막고 있어 **취소한 원서도 접수될 수 있었다**(취소 뒤 늦게 확인된 결제). CANCELLED·EXPIRED 는 409 ④ 자동 접수와 화면 제출이 겹치면 늦은 쪽도 같은 접수를 돌려준다 ⑤ 화면: 결제 전 고지 · 결제 확인 즉시 접수 완료 화면. 시험 5종(취소 가드는 가드를 빼면 깨지는 것까지 확인) · 브라우저 확인 |
| **D-40 과의 관계** | D-40 의 "자동 Finalize 하지 않음" 을 이 결정이 대체한다. 콜백·재확인 워커·대조 스케줄은 그대로다 |
| **노션 반영** | ✅ §01 §A4·§B4 "자동 Finalize 하지 않음" 을 "결제 확정 시 자동 접수, 결제 전 접수 가능 점검" 으로 (2026-09-27) · ✅ §03 첨부 yaml v1.2.0 교체 (2026-09-27) · ✅ §07 5단계 고지 문구 (2026-09-27) |
| **상태** | 🟢 CLOSED — 저장소·노션 반영 (2026-09-27) |

---

## D-43. KRDS 와이어프레임 결제 화면이 "결제 = 접수"(D-42) 와 반대로 안내한다

| | |
|---|---|
| **발견** | 2026-09-27 (첨부 배치 중) |
| **충돌** | §07 첨부 `k-admission-krds-wireframe.html` 의 검토·결제 화면(#s4)이 "결제 완료만으로는 접수가 끝나지 않습니다. 결제 후 최종제출을 완료해야 합니다" 라고 안내하고, 별도 최종제출 화면(#s5)에 제출 버튼이 있다. D-42 는 결제 확인 시 서버가 접수한다 |
| **판정** | **D-42 를 따른다.** §07 본문과 실제 화면은 이미 "결제가 확인되면 바로 접수가 완료됩니다" 로 고쳤다. 와이어프레임은 저충실도 참고물이라 코드에 영향은 없다 |
| **저장소 반영** | ✅ (2026-09-30) `docs/spec-assets/krds-wireframe.html` v1.2 — #s4 "결제가 확인되면 바로 접수가 완료됩니다"·"전형료 결제하고 접수"·결제 전 수정·취소 불가 확인, #s5 는 "결제 확인 중(다시 결제하지 마십시오)" 화면. 문구·단계 이름(6 최종제출 = 접수 결과·수동 재시도)은 실제 화면(`apps/frontend`)과 같다. 8,548바이트 |
| **노션 반영** | ⬜ §07 첨부 교체 — 노션 페이지 수정이 권한 분류기에 막혀(2026-09-30, 외부 시스템 쓰기) 사용자 승인 대기. 올릴 파일·문구는 [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영 — 노션 첨부 교체 대기 |

---

## D-44. §05 Helm 첨부(runtime·values-m)가 현재 구현과 다르다

| | |
|---|---|
| **발견** | 2026-09-27 (첨부 배치 중 대조) |
| **차이** | ① `SPRING_PROFILES_ACTIVE` — 구현은 NestJS 다(D-3). 운영 모드는 `NODE_ENV=production` ② 컨테이너 포트 8080 — 구현은 `PORT`(기본 3001) ③ 프로브 `/internal/health/startup·ready·live` — 구현은 `/healthz`·`/readyz`(+ `/healthz/dependencies`, D-32). 계약 v1.2.0 이 기준 ④ 대조 CronJob `*/5` · `reconcile --max-batch` — 구현은 앱 안 스케줄러(1시간·advisory lock, D-40). 별도 이미지 명령이 없다 ⑤ 첨부에 event-relay·document-service·frontend Deployment 가 없다(values 에만 있다) ⑥ values 의 `configVersion`·`deadlinePolicyVersion` 을 배포값으로 박는다 — 구현은 DB 의 서명된 활성화 기록이 기준이다(T-M3-15). 배포로 바꾸면 2인 승인을 우회한다 |
| **⑦ 커넥션 예산 초과 (2026-09-28, 차트 렌더링에서 발견)** | 첨부 values-m 은 접수 API 최대 10 Pod × Pod 당 40 = **400 = 예산 400** 이다. 여기에 Relay(2 × 3)·서류 워커(5)를 더하면 **411 > 400.** 차트가 렌더링에서 막는다 — 마감 피크에 최대로 늘면 DB 가 커넥션을 거절한다. Pod 당 38 또는 예산 411 이상으로 첨부를 고쳐야 한다 |
| **판정 방향** | M4 Helm 차트는 **첨부의 구조·보안 설정(securityContext·PDB·HPA·topologySpread·NetworkPolicy)은 그대로** 따르고, 위 6가지는 구현을 따른다. ⑥ 은 차트에서 뺀다 — 마감·설정을 배포 값으로 주입하면 D-21·D-35 가 막은 단독 변경 경로가 된다 |
| **결정 (2026-09-30)** | ⑦ **Pod 당 38, 예산 400 유지** — 10 × 38 + Relay 6 + 서류 워커 5 = 391 ≤ 400. 예산을 올리려면 대학 DB 의 `max_connections`·메모리를 확인해야 하는데 그 근거가 없다. 38 과 40 의 처리량 차이는 Pod 당 목표 120 RPS 에서 무시할 수준이다. PgBouncer 를 쓰면 DB 가 보는 연결은 풀러 서버 연결(2 × 12 = 24)뿐이고, 앱 쪽 합계는 풀러 클라이언트 수용량 검사로 따로 막힌다 |
| **저장소 반영** | ✅ (2026-09-30) `values-m.yaml` v1.2(①~⑦·D-49·D-52 반영, 3,813바이트) · `runtime.yaml` v1.2 = **차트 렌더링 결과**(`scripts/render-runtime-attachment.mjs`, 33,814바이트). 손으로 쓴 첫 첨부가 구현과 갈라진 것이 원인이라, 이제 runtime 첨부는 차트에서 만들고 CI 가 `--check` 로 드리프트를 막는다(helm 4.3.0 설치 단계 추가). UNIV-A M 프로필이 처음으로 production 렌더링을 통과한다(서명 digest·실 검사 엔진 자리만 남음) |
| **노션 반영** | ⬜ §05 첨부 두 개 교체 — 노션 페이지 수정이 권한 분류기에 막혀(2026-09-30, 외부 시스템 쓰기) 사용자 승인 대기. 올릴 파일·문구는 [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영 — 노션 첨부 교체 대기 |

---

## D-45. 로컬 NetworkPolicy가 다른 대학 DB 포트까지 허용한다 🔴

| | |
|---|---|
| **발견** | 2026-09-28 (T-M4-42 NetworkPolicy 실효성 시험) |
| **충돌** | `deploy/local/values-local.yaml`은 대학 간 경로를 열지 않는다고 설명하지만, 공통 `dataEgress.ports`가 UNIV-A DB `5432`와 UNIV-B DB `5442`를 함께 허용한다. 실제 UNIV-A API Pod에서 두 포트 모두 TCP 연결에 성공했다. |
| **영향** | 두 대학 DB가 같은 Docker Desktop 호스트 IP를 쓰는 로컬 축소 환경에서, 한 대학 Pod가 다른 대학 DB의 네트워크 경계까지 도달한다. DB 인증은 별도 방어선이지만 T-M4-42의 대학별 네트워크 격리 주장을 만족하지 못한다. |
| **판정** | 공통 values에는 공유 Redis 포트만 두고, 각 대학 overlay가 자기 DB 포트만 추가한다. NetworkPolicy 실측으로 자기 DB 성공·다른 대학 DB timeout을 다시 확인한다. |
| **저장소 반영** | ✅ `deploy/local/values-local.yaml` · `values-univ-a.yaml` · `values-univ-b.yaml` — 공통은 Redis만, 대학별 overlay는 자기 DB 포트만 허용 |
| **노션 반영** | 해당 없음 — 노션 첨부가 아닌 로컬 축소 환경의 배포값 오류 |
| **검증** | 양 대학 모두 자기 DB·Redis·중앙·MinIO 연결 성공, 다른 대학 DB·임의 외부·Worker→중앙 timeout, Worker→자기 API 성공 |
| **상태** | 🟢 CLOSED — 저장소 반영·kind 실측 (2026-09-28) |

---

## D-46. 중앙 Sync Gateway가 현재 subjectRef 형식을 버린다 🔴

| | |
|---|---|
| **발견** | 2026-09-28 (T-M4-42 첫 실행) |
| **충돌** | D-39에서 `subjectRef`를 키 없는 64자리 SHA-256에서 `<keyId>.<base64url(HMAC-SHA256)>`로 바꿨지만, `SyncGatewayService`의 수신 검증은 여전히 `/^[0-9a-f]{64}$/`만 허용한다. 이벤트는 수신됐으나 `application_summary.subject_ref`가 모두 `null`이 되어 중앙 "내 원서"에서 찾을 수 없었다. |
| **판정** | `server-kit`에 현재 목적별 참조 형식 검증 함수를 단일 출처로 두고, Sync Gateway가 이를 사용한다. 실제 이벤트 수신→요약 저장→대시보드 조회 회귀 시험을 추가한다. |
| **저장소 반영** | ✅ `server-kit/isPurposeRef` · 중앙 Sync Gateway · 단위·통합 회귀 시험. 첫 격리 시험 실패 결과와 수정 후 통과 결과를 함께 보존 |
| **노션 반영** | 해당 없음 — D-39의 확정 형식을 구현 일부가 따라가지 못한 회귀 |
| **상태** | 🟢 CLOSED — 저장소 반영·T-M4-42 재통과 (2026-09-28) |

---

## D-47. CloudEvents subjectRef 계약이 DB 길이보다 긴 키 ID를 허용한다

| | |
|---|---|
| **발견** | 2026-09-28 (D-46 수정 전 계약 대조) |
| **충돌** | CloudEvents JSON Schema는 `subjectRef`의 `keyId`를 최대 64자로 허용해 전체 값이 최대 108자가 될 수 있다. 구현의 키 목록은 최대 16자이고 중앙 `application_summary.subject_ref`는 `varchar(64)`라 그런 이벤트를 저장할 수 없다. |
| **판정 방향** | 실제 생성기·DB에 맞춰 계약의 키 ID 상한을 16자로 좁힌다. 계약 첨부 변경이므로 저장소 JSON Schema와 노션 §04 첨부를 같은 작업에서 교체해야 한다. |
| **결정 (2026-09-30)** | 좁힌다. 생성기(`parseKeyRing`)와 중앙 DB 가 이미 16자라 기존 이벤트는 모두 그대로 통과한다 — 계약만 실제보다 넓었다 |
| **저장소 반영** | ✅ (2026-09-30) JSON Schema 패턴 `{1,64}` → `{1,16}`(5,787바이트) · 계약 적합성 시험 "키 ID 상한이 생성기와 같고 전체가 varchar(64) 에 들어간다" |
| **노션 반영** | ⬜ §04 첨부 교체·본문 패턴 — 노션 페이지 수정이 권한 분류기에 막혀(2026-09-30, 외부 시스템 쓰기) 사용자 승인 대기. 올릴 파일·문구는 [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영 — 노션 첨부 교체 대기 |

---

## D-48. Peak Mode 예약 시각은 있지만 HPA 전환 실행 주체가 없다 🟢

| | |
|---|---|
| **발견** | 2026-09-28 (T-M4-07 구현 대조) |
| **충돌** | §01 B1과 §05 첨부 `values-m.yaml`은 `peakMode.scheduledActivation`으로 D-1 사전 확장·마감 전 최소 replica 상향을 요구한다. 현재 차트는 배포할 때 `peakMode.enabled=true`인 경우에만 HPA 최소값을 올리고, 예약 시각을 읽어 실제 전환할 실행 주체는 없다. `suspendNonCriticalJobs`도 선언만 있고 사용하지 않는다. |
| **위험** | 예약 시각만 설정하면 자동 전환된다고 오인할 수 있다. HPA가 트래픽을 본 뒤 반응하므로 피크 시작 전에 필요한 여유 용량을 확보하지 못하고, 비핵심 대조 작업도 피크 중 DB 자원을 계속 사용한다. |
| **판정 방향** | 애플리케이션 Pod에 Kubernetes 수정 권한을 주지 않는다. 예약된 HPA/replica 변경은 Flux Pull 운영 저장소·배포 자동화가 수행하고, Data Plane 앱은 예약 시각을 읽어 비핵심 내부 작업만 억제한다. `scheduledActivation`만으로 Scale-out 완료를 주장하지 않는다. 도구 선택과 신뢰 경계는 ADR-0005로 확정했다. |
| **판정** | **예약 시각에 Git desired state를 서명 커밋으로 바꾸고 Flux가 Pull한다** (ADR-0006). 대학별 `peak-schedule.yaml`(사전 확장·작업 억제·종료) → 생성기 → HelmRelease 마지막 values `peak-mode.yaml`. 앱은 억제 시각~종료 시각에만 비핵심 작업을 멈추고, 종료 시각이 지나면 overlay가 늦어도 스스로 푼다 |
| **저장소 반영** | ✅ `scripts/peak-mode-sync.mjs`·`scripts/peak-mode/`·`.github/workflows/peak-mode.yml`·대학별 `peak-schedule.yaml`/`peak-mode.yaml`·HelmRelease valuesFiles·차트 `PEAK_MODE_ENDS_AT`·앱 억제 정책. 시험: 예약 계산 9건·앱 정책 3건 추가, CI overlay 일관성 검사 |
| **노션 반영** | 해당 없음 — 기존 요구를 실행할 주체가 저장소에 빠진 구현 공백 |
| **검증** | 로컬 kind 축소 환경 — 예약 창 시작 서명 커밋 → Flux 수렴 → API replica 2→3·억제/종료 env 전달(push 뒤 62초), 종료 커밋 → 2로 원복(33초), SourceVerified 유지. `tests/m4/results/peak-mode-gitops-2026-09-29T11-43-36-484Z.json`. GitHub 예약 워크플로 실행·운영 서명 주체는 실제 저장소 설정 필요 |
| **상태** | 🟢 CLOSED — 저장소 반영·로컬 Flux 실측 (2026-09-29) |

---

## D-49. 첨부 values-m 의 예시 예약 시각이 지나면 자동 대조가 영구히 멈춘다

| | |
|---|---|
| **발견** | 2026-09-29 (T-M4-07 예약 자동화 구현 대조) |
| **충돌** | §05 첨부 `values-m.yaml`은 `peakMode.scheduledActivation: "2026-09-11T03:00:00Z"`를 고정값으로 둔다. 앱은 이 시각부터 비핵심 작업을 억제하는데 종료 시각이 없어서, 첨부 values 그대로 배포하면 그 뒤로 1시간 자동 대조(D-40)가 **영구히** 돌지 않는다. |
| **위험** | 대조가 조용히 멈추면 결제·접수·중앙 ACK 불일치가 예외 큐에 올라오지 않는다. 피크를 지난 뒤에도 운영자는 알 수 없다. |
| **판정** | 예약 시각은 배포 기본값이 아니라 대학별 예약에서 온다(ADR-0006). HelmRelease가 마지막에 얹는 `peak-mode.yaml`이 평시에는 `scheduledActivation`을 비우고, 예약 창에서는 억제·종료 시각을 함께 준다. 앱은 `PEAK_MODE_ENDS_AT`이 지나면 억제를 푼다. 첨부 파일은 R5에 따라 고치지 않는다. |
| **저장소 반영** | ✅ 대학별 `peak-mode.yaml` overlay(평시 비움) · `tests/m4/gitops-manifests.mjs`가 overlay가 마지막 values인지 검사 |
| **노션 반영** | ⬜ values-m v1.2 가 `scheduledActivation: ""`·`scheduledEnd: ""`·`window: ""` 와 예약 출처 주석을 담았다(D-44 와 같은 파일). 노션 페이지 수정이 권한 분류기에 막혀(2026-09-30, 외부 시스템 쓰기) 사용자 승인 대기. 올릴 파일·문구는 [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영 — 노션 첨부 교체 대기 |

---

## D-50. 중앙 이벤트 본문이 CloudEvents 스키마와 다르다 — 취소 이벤트는 전부 거절됐다 🔴

| | |
|---|---|
| **발견** | 2026-09-30 (T-M4-22 업무 KPI `central_sync_lag_seconds` 가 로컬에서 6.6일로 나와 추적) |
| **충돌** | §04 첨부 `k-admission-cloudevents.schema.json`(저장소 사본과 바이트 동일)은 ① 취소 이벤트 본문에 `applicationId`·`cancelledAt`·`reasonCode`·`integrityHash` 를 요구하는데 구현은 `universityId`·`admissionYear`·`status`·`cancelledAt`·`refundRequired` 를 보냈다. ② 접수 이벤트는 `additionalProperties: false` 인데 `universityId`·`submittedAt` 을 더 실었다. ③ Relay 가 CloudEvents `subject` 에 대학 내부 원서 UUID(`aggregate_id`)를 그대로 실었다 — v1.0 §17.1 "Opaque Application ID" 위반. |
| **영향** | 중앙 Sync Gateway 는 `data.applicationId` 가 없으면 400 으로 거절하고, Relay 는 4xx 를 DEAD 로 보낸다. **접수 전 취소는 한 건도 중앙에 반영되지 않았다**(로컬 DB DEAD 6건, 2026-09-23). 중앙 "내 원서" 에 취소한 원서가 계속 작성 중으로 보일 수 있다. ③은 대학 내부 식별자가 중앙으로 새는 개인정보 최소화 위반이다. |
| **판정** | **스키마(첨부)가 canonical** — 구현을 스키마에 맞춘다. 본문은 `common/central/central-events.ts` 한 곳에서 만들고 스키마로 직접 검증한다(ajv). 취소 사유 문장은 여전히 보내지 않고 분류 `reasonCode: APPLICANT_REQUEST` 만 보낸다(취소는 지원자 본인만, D-7). 환불 필요 여부는 대학 예외 큐의 일이라 중앙에 보내지 않는다. `subject` 는 본문의 불투명 ID 를 쓴다. 중앙은 취소 이벤트의 상태를 이벤트 타입으로 정한다. |
| **저장소 반영** | ✅ `central-events.ts`(+ 스키마 검증 시험 4건) · 취소·접수 서비스 · `contracts/src/events.ts` 타입 · Relay `subject` · 중앙 상태 매핑 · 취소 통합 시험. 이미 DEAD 인 옛 본문 6건은 로컬 개발 데이터라 재전송하지 않는다(새 본문으로 다시 만들 수 없다) |
| **노션 반영** | 해당 없음 — 첨부 스키마는 그대로이고 구현이 따르게 했다 |
| **상태** | 🟢 CLOSED — 저장소 반영·CI 재현 DB 시험 통과 (2026-09-30) |

---

## D-51. 계약에 요청 한도 응답(429)이 없다

| | |
|---|---|
| **발견** | 2026-09-30 (T-M4-40 Adaptive Throttling 구현) |
| **충돌** | §01 B6·v1.0 §8.4·STRIDE D-02 는 세션·원서 단위 요청 한도를 요구하지만, §03 첨부 OpenAPI(v1.2.0)의 지원자 경로 어디에도 `429` 응답과 `Retry-After` 가 없다. 오류 코드도 `RATE_LIMITED` 가 없다. |
| **영향** | 계약만 보고 만든 클라이언트는 429 를 알 수 없는 오류로 다룬다. 자동저장 화면이 Retry-After 를 지키지 않고 곧바로 다시 보내면 한도가 풀리지 않는다. |
| **판정** | 구현은 요구대로 둔다(ADR-0007): `429` + `Retry-After` + problem `code: RATE_LIMITED`. 계약에는 지원자 경로 공통 응답으로 `429`(Problem, `Retry-After` 헤더)를 더한다 — optional 응답 추가라 호환 변경이다(§A16). |
| **저장소 반영** | ✅ (2026-09-30) OpenAPI **v1.3.0** — 공통 응답 `RateLimited`(Problem + `Retry-After`)를 한도가 걸리는 지원자 오퍼레이션 16개에 추가(78,382바이트). 계약 적합성 시험이 스로틀 분류 함수(`classifyRoute`)와 계약의 429 목록이 한 건도 다르지 않은지 검사한다. 함께 고친 것: CORS 가 `retry-after` 를 노출하지 않아 브라우저가 대기 시간을 읽을 수 없었다 → 노출. 자동저장이 429 를 "재시도 불가 실패" 로 멈췄다 → 내용·멱등키를 보관하고 Retry-After 뒤 한 번 자동 재시도 |
| **노션 반영** | ⬜ §03 첨부 v1.3.0 교체 — 노션 페이지 수정이 권한 분류기에 막혀(2026-09-30, 외부 시스템 쓰기) 사용자 승인 대기. 올릴 파일·문구는 [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영 — 노션 첨부 교체 대기 |

---

## D-52. "API 노드 강제 종료 무중단"은 Pod 설정만으로는 지킬 수 없다

| | |
|---|---|
| **발견** | 2026-09-30 (T-M4-39 다중 노드 kind 시험) |
| **충돌** | §08 시나리오 10 · M4 T-M4-39 는 "API Node 강제 종료 → 무중단" 을 요구한다. 차트는 API·PgBouncer 2개 이상, zone 분산, PDB, `maxUnavailable: 0`, preStop 을 갖췄다. 그러나 노드가 **예고 없이** 죽으면 쿠버네티스가 그 노드를 NotReady 로 판정할 때까지(kind 기본값에서 49초) Service 가 죽은 Pod 로 요청·DB 연결을 계속 보낸다. |
| **실측(축소 환경)** | 계획 정비(drain)는 무중단 — 요청 879건 실패 0. 강제 정지는 **정지 1.5초 뒤부터 66.6초까지 요청의 약 10%(1,681건 중 160건)가 2초 안에 응답받지 못했고**, 이후 노드가 죽은 채로 스스로 회복했다. 수정 전에는 DB 연결 시간 제한이 없어 141초 내내 72% 가 실패했다(노드 하나의 장애가 전체 장애) — 쿼리 시간 제한·끊긴 연결 폐기로 고쳤다. `tests/m4/results/node-failure-kind-2026-09-29T18-05-05-487Z.json`(전)·`…18-26-14-638Z.json`(후). **⚠️ 이 수치(약 10%·66초)는 측정 도구로 부풀려졌다** — 아래 「재측정」 |
| **재측정 (2026-09-30)** | 측정 도구 결함 둘을 찾았다 — 시험 스크립트가 부하 중 `kubectl` 을 동기로 불러 자기 이벤트 루프를 멈춰 요청을 한꺼번에 timeout 으로 셌고, Windows 호스트 → Docker Desktop 포트 전달이 노드 컨테이너 정지 때 50초 넘게 막혔다(클러스터 안 NodePort·Pod·DB 는 정상). 부하를 kind 네트워크 안 컨테이너로 옮기고 grace 16초·차트 결정값으로 다시 쟀다: drain 0/666, 정비 뒤 재분산 0/1,139, **노드 강제 정지 첫 시도 6.1%·체감 1.4%(3번 재시도 뒤)** — 실패는 거의 다 NotReady(22초) 전 죽은 Pod 로 간 연결 시간 초과(그 뒤 65~125초에 구간당 2~9건, 원인 미확인). 대체 Pod 는 살아 있는 zone 에 10초 뒤 Ready `node-failure-kind-2026-09-30T15-46-21-045Z.json` |
| **판정** | 앱이 할 수 있는 것은 했다: 매달린 DB 연결을 10초 안에 버리고 503 재시도 안내, 멱등키로 재시도를 안전하게. 남은 구간은 플랫폼 몫이다 — ① Edge/Ingress 가 연결 실패·시간 초과를 다른 Pod 로 재시도(모든 변경 요청에 Idempotency-Key 가 있어 POST/PATCH 재시도도 안전하다), ② K-PaaS 의 노드 장애 판정 시간(`node-monitor-grace-period`)을 대학 SLO 에 맞게 조정, ③ PgBouncer 를 API Pod 옆(sidecar)으로 옮겨 노드 간 DB 경로 의존을 없애는 안을 K-PaaS 부하 시험 때 비교. 또한 차트·첨부가 zone 분산을 `DoNotSchedule` 로 두어 **zone 이 2개면 한 zone 이 죽는 동안 대체 Pod 를 남은 zone 에 둘 수 없다**(maxSkew 1) — 3개 zone 또는 `minDomains` 검토가 필요하다(로컬에서는 기본 toleration 300초라 재배치 전에 노드를 되살려 미관측). |
| **결정 (2026-09-30, ADR-0008)** | ① zone 분산에 **`nodeTaintsPolicy: Honor` + `matchLabelKeys: [pod-template-hash]`** — 장애 노드를 분산 계산에서 빼 zone 2개에서도 대체·확장 Pod 가 살아 있는 zone 에 놓인다(zone 3개로도 기본값의 막힘은 안 풀린다) ② **정비 뒤 재분산**(uncordon 뒤 rollout restart·descheduler) — Honor 는 cordon 된 zone 도 빼 정비 동안 한 zone 에 모인다(재분산 없이 노드를 멈추자 전면 장애 실측) ③ **PgBouncer 정상 종료** — preStop 10초·grace 60초·앱 풀이 연결을 사용 50회·idle 10초로 돌림(rolling restart 체감 실패 2 → 0. 시간 기준 수명은 pg-pool 대기열 멈춤으로 버렸다) ④ 노드 판정 시간은 대학 SLO 에 맞춰 줄인다(grace ≥ 상태 보고 × 4) ⑤ **Edge 가 연결 실패·연결 시간 초과를 다른 엔드포인트로 1회 재시도**(POST/PATCH 포함 — 멱등키) — 남은 실패가 바로 이것이다 ⑥ Edge 는 Gateway API 컨트롤러(D-53) ⑦ PgBouncer `trafficDistribution`(PreferSameZone)은 쓰지 않는다 — 이득이 작고 rolling restart 체감 실패 10건 ⑧ PgBouncer sidecar 는 K-PaaS 부하 시험 때 비교 |
| **저장소 반영** | 🟡 DB 풀 시간 제한·끊긴 연결 폐기·503(`server-kit` db, 문제 필터), 다중 노드 시험(`kind-univ-a-multinode.yaml`·`values-multinode.yaml`·`node-failure-kind.mjs`). ✅ (2026-09-30) 차트 `nodeTaintsPolicy: Honor`·`matchLabelKeys`(values·values-m v1.2), PgBouncer preStop·grace·`server-kit` 연결 사용 횟수(`maxUses` 50), 선택 사항 `database.pooler.trafficDistribution`(기본 끔), 판정 시간 비교용 `kind-univ-a-multinode-tuned.yaml`, 시험에 정비 뒤 재분산·죽은 노드 Pod 축출·DB 세션 표본·구간별 경로 측정·이벤트 루프 지연 단계, 부하 생성기를 kind 네트워크 안 컨테이너로(`helpers/load-users.mjs`) |
| **노션 반영** | ⬜ §08 시나리오 10 합격 기준·§05 노드 장애 흡수 절 — [06-notion-changeset.md](06-notion-changeset.md) (노션 쓰기 승인 대기) |
| **상태** | 🟡 결정·로컬 재측정 완료 — Edge 재시도는 K-PaaS 에서 실측, 노션 반영 대기 |

---

## D-53. §06 첨부·차트가 Edge 로 가정한 ingress-nginx 가 은퇴했다

| | |
|---|---|
| **발견** | 2026-09-30 (D-52 Edge 재시도 정책을 정하다가 확인) |
| **충돌** | §06 첨부 `network-rbac.yaml` 과 차트 `networkPolicy.ingressFrom` 기본값은 공개 트래픽 입구를 edge 네임스페이스의 `ingress-nginx` 로 둔다. Kubernetes SIG Network 는 ingress-nginx 를 **2026년 3월 은퇴**시켰다 — 이후 버그 수정·보안 패치가 없다(Kubernetes 공식 블로그·SRC 공지). |
| **영향** | 운영 입구에 보안 패치 없는 컨트롤러를 두게 된다. 설계가 요구하는 Edge 재시도(D-52)·WAF 연동도 이 컨트롤러 기준으로 쓰면 곧 다시 바꿔야 한다. |
| **판정** | **Edge 는 Gateway API 를 지원하는 유지보수 중인 컨트롤러로 한다**(ADR-0008). 구체 제품은 K-PaaS 가 제공하는 것을 따른다. 차트는 입구 선택자를 values 로 받으므로 코드 변경은 없다 — 대학 values 에서 `networkPolicy.ingressFrom` 을 그 컨트롤러로 바꾼다. |
| **저장소 반영** | ✅ ADR-0008 · 차트 values 주석. 기본값 선택자는 §06 첨부와 같게 두었다(첨부 교체 전까지 R5) |
| **노션 반영** | ⬜ §06 NetworkPolicy 첨부의 edge 선택자와 §05 Edge 서술 — [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 판정 — K-PaaS Edge 확정·노션 반영 대기 |

---

## D-54. 리더 잠금(세션 advisory lock)이 PgBouncer transaction 풀에서 새어 워커가 주기를 건너뛴다 🔴

| | |
|---|---|
| **발견** | 2026-09-30 (T-M4-34 PG 지연 실제 시간 시험) |
| **충돌** | §B3 은 "한 Pod 만 도는 워커" 와 DB 앞 연결 풀(PgBouncer, T-M4-09, transaction 모드)을 함께 요구한다. `withLeaderLock` 은 **세션** advisory lock(`pg_try_advisory_lock` → 작업 → `pg_advisory_unlock`)을 썼다. transaction 풀에서는 문장마다 다른 서버 연결로 갈 수 있어 잠근 연결과 푸는 연결이 달라진다 — PgBouncer 문서도 transaction 모드에서 세션 advisory lock 을 지원하지 않는다고 적는다. |
| **실측(축소 환경)** | 결제 재확인 워커(30초 주기)가 06:25:37 이후 06:28:46 까지 한 번도 돌지 않았다. `pg_locks` 에서 PgBouncer 서버 연결(idle, 트랜잭션 밖)이 `payment:recheck` 잠금을 쥔 채 남아 있었다. 그 결과 콜백 없이 폴링만으로 확정되는 결제가 PG 확정 뒤 171.9초(1분 지연)·533.9초(5분 지연) 걸렸다 — 설계 Backoff(30초 × 2^n) 대로면 30~60초·약 150초다. 콜백 경로는 5~10초로 정상. `tests/m4/results/pg-delay-realtime-2026-09-30T06-24-46-019Z.json`(중단한 수정 전 실행) |
| **영향** | 같은 잠금을 쓰는 **결제 재확인·1시간 자동 대조·멱등 기록 정리가 모두 우연히 그 서버 연결에 닿은 주기에만 돈다.** 세션 잠금은 같은 세션에서 다시 잡히므로 두 Pod 가 그 연결을 번갈아 쓰면 동시에 도는 일도 생긴다("한 Pod 만" 보장 붕괴). 결제 자동 정합화(D-40)·대조 경보가 설계보다 늦어진다. 단일 노드·직접 DB 연결인 CI·통합 시험에서는 드러나지 않았다. |
| **판정** | **트랜잭션 잠금으로 바꾼다** — 잠금 전용 연결에서 BEGIN → `pg_try_advisory_xact_lock` → 작업(다른 연결) → COMMIT. transaction 풀은 트랜잭션 동안 서버 연결을 바꾸지 않고, 트랜잭션이 끝나면 잠금이 반드시 풀린다. 이 트랜잭션은 행을 잠그지 않고 READ COMMITTED 라 스냅샷도 놓으므로 비용은 연결 하나(전과 같다). 키는 **두 정수 키 `(0x4B41, hashtext(name))`** — 운영에 이미 새어 남은 한 정수 키 세션 잠금이 있어도 새 잠금을 막지 못한다. |
| **저장소 반영** | ✅ (2026-09-30) `common/scheduling/leader-lock.ts` · 회귀 시험 `leader-lock.integration.test.ts`(작업 성공·실패 뒤 잠금 0, 쥐는 동안 다른 호출 차단) · 결제 재확인 시험의 "다른 Pod 가 쥔 잠금" 흉내를 새 키로 |
| **노션 반영** | 해당 없음 — 설계 요구(한 Pod 만·연결 풀)를 구현이 함께 지키지 못한 결함 |
| **검증** | 수정 이미지로 T-M4-34 재실행 — 폴링 경로 49.9초(1분 지연)·171.3초(5분 지연)·52.6초·118.6초로 설계 Backoff 안, 8건 모두 통과 (\`pg-delay-realtime-2026-09-30T06-43-39-291Z.json\`). 수정 이미지를 올릴 때 PgBouncer 는 재시작하지 않았다 — 옛 세션 잠금이 서버 연결에 남아 있었을 수 있는 상태에서 워커가 정상 주기로 돌았다(옛 잠금의 존재는 따로 확인하지 않았다) |
| **상태** | 🟢 CLOSED — 저장소 반영·실제 시간 재측정 통과 (2026-09-30) |

---

> **D-55 ~ D-61 — 미완결 기능 전수 점검 (2026-09-30).** "목업으로만 있거나 끝까지 이어지지 않은 코드" 를 전부 찾아 고친 결과다.
> 요약은 [04-production-readiness.md §7](04-production-readiness.md#7-흉내미연결-전수-점검-2026-09-30).
> ⚠️ 번호 정정: 커밋 `b05f629` 메시지의 `D-54 · D-55 · D-56` 은 같은 날 다른 작업이 D-54(리더 잠금)를 먼저 올려 **이 대장의 D-55 · D-56 · D-57/D-58** 이다. 코드·계약 주석은 새 번호로 고쳤다.

## D-55. 원서 상태머신이 정의만 있고 흐름에 연결되지 않았다 — 한 원서에 결제창을 몇 개든 열 수 있었다 🔴

| | |
|---|---|
| **발견** | 2026-09-30 (미완결 기능 전수 점검) |
| **충돌** | v1.0 §5.6 은 `DRAFT → READY → PAYMENT_PENDING → PAID → FINALIZING → FINALIZED` 를 규정하고 `@wonseoro/contracts` 전이 표도 있었다. 그러나 코드는 원서 상태를 **DRAFT 에서 FINALIZED(또는 CANCELLED)로만** 옮겼다 — READY·PAYMENT_PENDING·PAID·FINALIZING·EXPIRED 를 쓰는 곳이 없었고, `ApplicationStateService.plan()` 은 "Postgres 어댑터는 T-M1-01 후 구현" 주석과 함께 어디서도 불리지 않았다 |
| **드러난 결함** | ① 결제 의도를 **같은 원서에 몇 번이든** 만들 수 있었다(DDL 에 제약 없음). 새로고침하면 화면이 결제 상태를 잊어 다시 "결제" 를 보였다 — 결제창 둘 = 이중 결제(§B4). ② 결제를 시작한 원서를 계속 고칠 수 있었다 — 결제 전 확인(D-42)을 통과한 뒤 필수 항목을 지우면 돈만 받고 자동 접수가 거절된다. ③ Self-check 의 "결제 진행 중·결제 확인됨" 안내가 나올 수 없었다. ④ 취소 규칙(D-7)의 "환불이 따르는 상태(PAYMENT_PENDING·PAID)" 가 실제로는 오지 않았다 |
| **판정** | 상태머신을 흐름에 잇는다 — 검증 통과 READY, 저장 시 READY→DRAFT, 결제 의도 PAYMENT_PENDING(이후 수정·서류 변경 409), 결제 확정 PAID(같은 트랜잭션), 실패·취소 READY. **한 원서에 살아 있는 결제는 하나** — 열린 결제창(CREATED)은 재사용(200), 확인 중·확정이면 409 `PAYMENT_IN_PROGRESS`, 동시 요청은 원서 행 잠금으로 줄 세운다. **FINALIZING 은 DB 에 쓰지 않는다** — §02 8단계 Finalize 가 한 트랜잭션이라 커밋 전에만 존재하고 실패는 롤백 = PAID 유지("FINALIZING → PAID" 와 같다). 전이 표에 `PAID → FINALIZED` 를 더했다. **EXPIRED 는 아직 옮기지 않는다** — 마감 연장(§B17)이 있어 마감 시각에 옮기면 되돌릴 수 없다. 모집 종료(주기 CLOSED) 처리와 함께 정한다 |
| **함께 연결한 것** | PG 어댑터의 `reconcile()`(정산 목록)이 반환만 하고 어디서도 불리지 않았다 → 대조 9번 **PG 정산 대조**: PG 는 승인했는데 우리는 CREATED·PENDING·UNKNOWN 인 결제를 재조회해 자동 접수까지 잇고(재확인 워커는 CREATED 를 묻지 않아 콜백 유실 시 아무도 못 찾았다), 우리 확정·PG 미승인은 CRITICAL. Mock 정산 목록 구현. `cancel()` 은 **자동으로 부르지 않는다**(승인된 결제 취소 = 환불, 사람 승인 — D-7 ④) |
| **저장소 반영** | ✅ (2026-09-30) `transitionApplication`·결제 서비스·Finalize·서류·대조·Self-check·지원자 화면(결제 복원·"결제 상태 다시 확인"·취소 화면). 시험: 상태 전이·결제창 재사용·동시 5요청 결제 1건·확인 중 409·정산 대조 |
| **노션 반영** | ⬜ v1.0 §5.6 전이(`PAID → FINALIZED`, FINALIZING 비저장, EXPIRED 보류)·§03 첨부 v1.4.0 — [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영 — 노션 반영 대기 |

---

## D-56. 화면이 전형 설정을 다 읽지 않았다 — 서류 종류·공통원서 항목·항목 이름이 코드에 박혀 있었다 🔴

| | |
|---|---|
| **발견** | 2026-09-30 (미완결 기능 전수 점검) |
| **충돌** | §A5 "대학 차이는 Configuration + JSON Schema 로, 코드 fork 0". 그러나 ① 서류 단계가 `TRANSCRIPT`(학교생활기록부) 하나를 **화면에 박아** 올렸고, 접수 쪽 필수 서류(`requiredDocuments`)와 연결되지 않았다(업로드는 아무 서류 종류나 받았다) ② 공통원서에서 가져올 항목(`highSchool·graduationYear·contactEmail`)이 화면과 Vault 요청에 **각각** 박혀 있었다("전형 Config 로 옮기는 것이 M3 과제" 주석) ③ 항목 이름 사전(`FALLBACK_LABELS`)이 화면에 박혀 새 전형의 항목만 코드로 보였다 ④ 활성 설정이 있어도 전형 양식이 비어 있으면 **아무 항목이나** 저장했다("M1 개발 편의") ⑤ Config Linter(§A5)가 없었다 — 컴파일되지 않는 JSON Schema 가 2인 승인·적용되면 그 전형의 저장·검증·결제가 모두 503 이 된다 |
| **판정** | 화면은 설정만 보고 그린다. form-schema 응답에 `profileFields`(속성 `"x-profile": true`)·`documents`(`requiredDocuments`·`optionalDocuments`·`documentLabels`)를 싣는다 — 필수 서류 검사·업로드 허용 종류·Vault 요청이 같은 출처를 쓴다. 표시가 없는 옛 설정은 기본 항목을 쓰고 설정 검사가 경고한다. **Config Linter** — 초안을 만들 때 런타임과 같은 Ajv 로 양식을 컴파일하고 서류 목록 형식을 본다(오류는 초안 거절, 모르는 전형 코드·title 없음·표준 밖 x-profile 은 Diff 경고) |
| **저장소 반영** | ✅ (2026-09-30) `config-lint.ts`·form-schema·서류·Vault 요청·지원자 화면·개발 시드(title·x-profile·선택 서류). 서류 종류는 설정에 목록이 있을 때만 제한한다(옛 설정 호환) |
| **노션 반영** | ⬜ §03 첨부 v1.4.0(FormSchema `profileFields`·`documents`, ConfigDiff `warnings`) · §A5 Config Linter 규칙 — [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영 — 노션 반영 대기 |

---

## D-57. 공통원서를 쓰는 길이 개발용 내부 API 뿐이었고, 화면은 가명 토큰을 지어냈다 🔴

| | |
|---|---|
| **발견** | 2026-09-30 (미완결 기능 전수 점검) |
| **충돌** | v1.1 §10 §3 은 공통원서를 한 번 쓰고 동의한 항목만 대학 원서로 복사한다. 그러나 ① 공통원서를 쓰는 경로는 `POST /internal/v1/profiles`("M2 개발 편의용")뿐 — 본문의 토큰으로 **누구의 공통원서든 덮어썼고** 입력 검사가 없었으며, 화면은 그것을 부르지 않았다(원서 1단계 "공통원서에서 가져온 정보" 는 늘 비어 있었다) ② 지원자 화면이 가명 토큰을 `subj-<식별자 앞 8자>` 로 **지어냈다** — 대학 DB 등록값과 달라 "내 원서" 가 늘 비었고 Vault 도 엉뚱한 토큰으로 조회했다 ③ 대학은 헤더가 주장하는 토큰을 그대로 믿어 Vault 에 물었다 ④ 중앙에는 운영 모드에서 개발용 신원 헤더를 막는 장치(R8)가 없었다 ⑤ 중앙은 깨진 UTF-8 을 U+FFFD 로 바꿔 저장했다(D-37 이 중앙엔 없었다) |
| **판정** | 중앙에 지원자용 `GET·PUT /api/v1/profile`(신원은 인증 헤더로만, 본문 토큰 받지 않음, PUT 통째 교체·동의 목록에서 뺀 대학은 철회 기록). **공통원서 표준 항목**을 계약 패키지 한 곳(`COMMON_PROFILE_FIELDS`: 출신 고등학교·졸업 연도·이메일·휴대전화)에 두고 중앙 검증·화면·설정 검사가 같이 쓴다. 대학은 **등록된 지원자 토큰**으로 Vault 에 묻고 헤더가 다르면 403. 중앙 `AUTH_MODE`(운영에서 dev-headers 기동 거부)·엄격 UTF-8 파서. 개발용 내부 경로는 지웠다 |
| **저장소 반영** | ✅ (2026-09-30) 중앙 profile API·검증·시험, 지원자 `/profile` 화면·개발 본인확인(등록 토큰 입력), 원서 생성 응답이 복사된 항목을 돌려준다(전에는 늘 빈 값) |
| **노션 반영** | ⬜ §03 첨부 v1.4.0(`getMyProfile`·`replaceMyProfile`) · v1.0 §5 공통원서 표준 항목 — [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영 — 노션 반영 대기 |

---

## D-58. 서류 검사 엔진이 파일을 읽지 않는 흉내뿐이었고, 검사 기록은 늘 'mock-av' 였다

| | |
|---|---|
| **발견** | 2026-09-30 (미완결 기능 전수 점검) |
| **충돌** | v1.0 §5.4 · §B5 는 AV 검사를 요구한다. 검사 워커의 유일한 엔진은 파일명 표식으로 판정하는 Mock 이었고(운영 기동은 막혀 있다, R8), 접수 API 는 워커가 보낸 엔진·버전을 버리고 모든 검사 기록에 `mock-av` 를 남겼다 — 실엔진을 붙여도 증적(Evidence Package)은 거짓이 된다. 엔진 장애와 "검사 실패" 를 구분하지 않았다 |
| **판정** | 엔진을 추상화하고 **ClamAV(clamd INSTREAM)** 어댑터를 둔다(`SCANNER_ENGINE=clamav`). 워커는 저장소 자격증명 없이 접수 API 가 검사 대기 목록에 싣는 **파일 하나·몇 분짜리 서명 URL** 로 읽어 흘려보내고, 흘리는 동안 SHA-256 을 기록과 맞춘다. 엔진·서명 DB 버전을 clamd 에 묻어 기록한다. 엔진에 닿지 못하면 판정하지 않고 검사 대기로 남긴다. 차트: `documentService.clamav.host`·`scannerEgress`(clamav 일 때만 워커 출구) |
| **남은 것** | 실제 clamd·서명 DB 로 돌린 확인은 없다 — 시험은 같은 프로토콜의 가짜 clamd 다(clamd 이미지·서명 DB 내려받기 필요). clamd 배치(사이드카·공용 서비스)는 K-PaaS 착수 때 정한다 |
| **저장소 반영** | ✅ (2026-09-30) `engines.ts`·시험 8개(서류 워커의 첫 시험)·검사 대기 목록 `downloadUrl`·검사 기록 엔진·버전·서명 이름 |
| **노션 반영** | ⬜ §03 첨부 v1.4.0(`downloadUrl`·`signature`) · §05 서류 워커 구성(clamd) — [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 어댑터 구현 — 실 clamd 연동 확인 대기(T-M5-08) |

---

## D-59. 운영 콘솔에서 설정 초안을 만들 수 없었고, 보존기간 화면이 없었다

| | |
|---|---|
| **발견** | 2026-09-30 (미완결 기능 전수 점검) |
| **충돌** | §A14 "Configuration Governance" 는 콘솔에서 Diff·2인 승인·적용을 한다. 콘솔은 승인·적용·되돌리기만 있었고 **초안을 만드는 곳이 없어** API 를 직접 불러야 했다. 현재 설정 조회(`getActiveConfig`)는 본문을 주지 않아 고칠 출발점도 없었다. 보존기간(§A15) 계획 API 는 있는데 화면이 없었다 |
| **판정** | 현재 설정 조회가 본문(`config`)을 준다. 콘솔 "새 설정 초안 만들기"(현재 설정 복사 → JSON 편집 → 초안), Diff 에 설정 검사 경고, 보존기간 화면(계획만 보인다 — 지우지 않는다). 초안 생성은 Config Linter(D-56)를 거친다 |
| **저장소 반영** | ✅ (2026-09-30) admin-web `config`·`retention`, admission-api `config/active` |
| **노션 반영** | ⬜ §03 첨부 v1.4.0(`getActiveConfig` 본문·`createConfigVersion` 검사 규칙) — [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영 — 노션 반영 대기 |

---

## D-60. §04 심장박동(sync.heartbeat)을 아무도 보내지 않아 중앙이 조용한 대학과 죽은 대학을 구별하지 못했다 🔴

| | |
|---|---|
| **발견** | 2026-09-30 (계약 검사 스크립트가 코드·스키마 이벤트 타입을 대조하다가) |
| **충돌** | §04 스키마는 `kr.kadmission.sync.heartbeat.v1`(적체·설정 버전·시계 offset)을 정의하고 중앙 DDL 에도 `last_heartbeat_at` 등 자리가 있었다. 그러나 대학은 보내지 않았고, 중앙은 `data.applicationId` 가 없다며 **받을 수도 없었다.** T-M4-42 의 "중앙 Dashboard 는 A대만 확인 불가로 표시" 를 뒷받침할 신호가 없었다. 또 ① Relay 가 모든 이벤트의 `configversion`·`policyversion` 을 **빈 문자열**로 보냈다(D-50 로 본문에서 두 값이 빠진 뒤 읽을 곳이 없었다) ② 등록되지 않은 대학의 이벤트가 외래키 오류로 500 이 되어 Relay 가 중앙 장애로 알고 재시도했다 ③ 계약은 이벤트 수신에 Idempotency-Key 를 요구했지만 실제 중복 제거는 CloudEvents `(source, id)` 였다 ④ 코드에 스키마에 없는 `payment.refunded.v1` 상수가 있었다 |
| **판정** | event-relay 가 심장박동을 주기(기본 60초)로 보낸다 — Outbox 를 거치지 않는다(지난 상태를 나중에 현재처럼 보내지 않게, 중앙이 끊기면 건너뛴다). 중앙은 수신 원장·gap 을 거치지 않고 대학 상태를 덮어쓴다. "내 원서" 는 대학 이름과 `universityReachable`(심장박동 180초 끊김 = 확인 불가)을 준다. 버전 확장 속성은 접수 기록에서 읽어 싣고, 미등록 대학은 400. **`payment.confirmed.v1` 은 보내지 않는다** — 결제 확정이 곧 접수(D-42)라 접수 이벤트가 같은 사실을 전하고 금액·수단은 중앙이 알 필요가 없다(§A3). `payment.refunded` 상수는 지웠다(실 PG 연동 T-M6-04 의 환불 처리 때 스키마에 먼저 올린다) |
| **저장소 반영** | ✅ (2026-09-30) `heartbeat.service.ts`(계약 스키마로 검증하는 시험)·중앙 수신·상태·Dashboard·화면 "이 대학 확인 불가" · `scripts/check-contracts.mjs` 가 코드 이벤트 타입을 스키마와 대조한다 |
| **노션 반영** | ⬜ §04 본문 — 심장박동 발송·수신 규칙, payment.confirmed 미발송 판정 · §03 첨부 v1.4.0(`ApplicationSummary`·이벤트 수신 규칙) — [06-notion-changeset.md](06-notion-changeset.md) |
| **kind 확인** | ✅ (2026-10-01) 최신 이미지로 kind A·B 재배포 뒤 중앙 `university_sync_state` 에 두 대학 심장박동이 26초 전 기록(설정 버전·적체 0 포함) |
| **상태** | 🟡 저장소 반영·kind 확인 — 노션 반영 대기 |

---

## D-61. §A9 시각 동기화가 없었다 — clock offset 은 늘 0 이었고, 접수 시각은 Pod 시계였다 🔴

| | |
|---|---|
| **발견** | 2026-09-30 (미완결 기능 전수 점검) |
| **충돌** | §A9 "복수 독립 Time Source · clock offset 지속 측정 · 허용오차 초과 Node 는 Finalization 에서 제거 · 감사로그에 offset·time-source 상태 기록". §A2(D-31 반영)는 "접수·마감 판정 시각은 DB 시각". 그러나 `assertClockHealthy()` 는 시험에서만 불렸고("M4 에서 측정값과 연결한다" 주석), 서버 시각 응답의 `clockOffsetMs` 와 접수 기록의 `server_clock_offset_ms` 는 **0 고정**, Finalize 의 커밋 시각·마감 판정은 Pod 의 `new Date()` 였다(D-31 은 활성화 시각만 고쳤다) |
| **판정** | 노드 시계와 DB 시계를 두 독립 시각원으로 **계속 대조**한다(10초마다 3회, 왕복이 가장 짧은 표본, 불확실성 = 왕복/2). DB 밖에서 쓰는 시각(요청 수신·화면 표시·감사)은 측정 offset 으로 DB 시계에 맞추고, **접수 커밋 시각은 트랜잭션 안에서 DB 에 묻는다.** 불확실성을 빼고도 1초를 넘은 노드는 Finalize 만 503(다른 Pod 가 받는다 — 전체 트래픽에서 빼면 접수가 줄어든다). 접수 기록·APPLICATION_FINALIZED 감사에 offset·불확실성·상태를 남긴다. `/healthz/dependencies`·지표 `clock_offset_ms` |
| **남은 것** | 외부 NTP 와의 대조는 하지 않는다 — DB 시계 자체가 틀리면 모든 노드가 같은 방향으로 틀린다. K-PaaS 착수 때 DB 서버의 시각 동기 감시(chrony 등)를 인프라 요구로 둔다 |
| **저장소 반영** | ✅ (2026-09-30) `common/time/server-clock.ts`·Finalize·마감 판정·감사·멱등 만료 시각. 시험: 표본 선택·상태 판정·허용오차 초과 노드 503·offset 기록. 로컬 축소 환경 측정 −31 ~ +151ms |
| **노션 반영** | ⬜ §01 A9 구현 방식(두 시각원·Finalize 만 제외) — [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영 — 노션 반영 대기 |

---

## D-62. 원서별 감사 체인이 멀쩡한 기록을 "끊김"으로 판정한다 — 시각 역전·동시 기록 🔴

| | |
|---|---|
| **발견** | 2026-10-01 (화면 제품화 전수 점검 중 캡처 [26 증적 조회](screenshots/admin/26-evidence.png)를 보다가 — [08-ui-production-readiness.md](08-ui-production-readiness.md#함께-발견한-결함--증적의-감사-체인-거짓-끊김-d-62)) |
| **충돌** | 설계 요구: v1.0 §9·v1.1 §A11 은 감사 hash-chain 으로 "중간 기록을 지우거나 고치면 드러난다"를 요구한다. 증적 패키지(T-M3-07)·조회 화면(T-M3-13)은 체인이 끊기면 "증거로 쓸 수 없다"고 판정한다. 발견: 캡처 환경(축소 환경, 2026-09-30, 전용 DB)에서 **정상 흐름으로 접수한 첫 번째 원서**의 증적이 "감사 체인이 끊겨 있습니다"를 보였다. 이 원서는 연출 준비(`prepare.sh recon`)를 거치지 않았다. 같은 화면의 타임라인은 시각순인데 결제 시작(`PAYMENT_INTENT_CREATED`)이 접수 완료(`APPLICATION_FINALIZED`) **뒤에** 온다 — 기록한 순서와 `occurred_at` 순서가 어긋났다 |
| **원인** | ① **시각 역전**: `AuditService.record` 는 원서 체인의 `occurred_at` 을 `serverNow()`(노드 시계 − 측정 offset)로 찍는다. D-61 이후 offset 은 10초마다 새 측정값으로 **통째로 바뀐다**(`ServerClock.record`). 로컬 측정 범위가 −31 ~ +151ms 라, 몇십 ms 간격으로 이어 쓰는 기록(결제 의도 → Mock PG 즉시 확정 → 자동 접수)은 시각이 거꾸로 갈 수 있다. 다음 기록의 앞 해시 조회(`lastHash`)와 검증(`verifyChain`)은 둘 다 `occurred_at` 순서를 믿는다. **시스템 체인**에는 "직전보다 1ms 뒤" 보정과 잠금이 있다(`audit.service.ts:56-62`·`130-139`, 주석이 바로 이 문제를 적고 있다). **원서 체인에는 둘 다 없다.** ② **동시 기록**: 원서 체인은 잠그지 않는다. 같은 원서에 두 트랜잭션이 동시에 `lastHash` 를 읽으면 같은 앞 해시에 둘이 붙어 체인이 갈라진다. 예: 지원자 요청과 서류 검사 결과·결제 콜백 같은 SYSTEM 기록 |
| **영향** | 변조가 없어도 증적이 "쓸 수 없음"이 된다. 마감 직전 결제·접수가 몰린 원서일수록 걸리기 쉬운데, 분쟁 때 가장 필요한 원서가 바로 그런 원서다. "끊김" 경보가 잦으면 진짜 변조가 묻힌다. CI·통합 시험은 offset 0·순차 호출이라 드러나지 않았다 |
| **판정** | 원서 체인도 시스템 체인처럼 만든다. **원서 행 잠금**(`SELECT … FROM application … FOR NO KEY UPDATE`)과 **직전 기록보다 반드시 뒤 시각**을 둔다. 새 advisory 잠금이 아니라 원서 행 잠금인 까닭은 교착이다 — 원서를 바꾸는 흐름(저장·결제 의도·접수)은 이미 이 행을 먼저 잠그고, 결제 확인·서류 검사는 결제·서류 행 → 원서 행 순서라 잠금 순서가 새로 생기지 않는다. `FOR NO KEY UPDATE` 는 다른 표가 이 원서를 참조하며 들어오는 것(외래키 KEY SHARE)을 막지 않는다. 체인 끝은 시각이 아니라 "아무도 앞 해시로 가리키지 않는 기록" 으로 찾는다. 검증도 바꾼다. 시각 정렬 대신 `prev_hash` 연결을 따라가며 판정하면, 이미 쌓인 시각 역전 기록도 살린다. 중간 기록을 지우면 연결이 끊기므로 변조 검출은 그대로다. 갈라진 체인(동시 기록)은 연결을 따라가도 끊김이 맞다 — 거짓 경보가 아니다 |
| **재현 시험** | `modules/audit/audit-chain.integration.test.ts` 3개 — ① 기록 사이에 offset 이 0.5초 뒤로 뛴다 ② 같은 원서에 동시 기록(첫 트랜잭션이 커밋 전에 머무는 동안 두 번째가 기록) ③ 고치기 전 코드가 남긴 모양(연결은 맞고 시각만 뒤집힘)이 통과하고, 갈라진 체인·지운 중간 기록은 끊김으로 지목된다. **고치기 전 코드에서 셋 다 실패했다** — ① 시각순 첫 기록이 GENESIS 가 아님 ② 세 기록의 앞 해시가 2종(갈라짐) ③ "끊김" |
| **저장소 반영** | ✅ (2026-10-01) `audit.service.ts` — 원서 체인 잠금·시각 단조·연결 끝 조회, 검증은 GENESIS 부터 연결을 따라간다(해시 불일치·갈라짐·닿지 못한 기록 = 끊김). 기존 변조 검출 시험·시스템 체인 시험 그대로 통과. admission-api 315개(CI 재현 DB, 실패 0·건너뜀 3) |
| **노션 반영** | 해당 없음 — 설계 요구(§A11 체인)를 구현이 못 지킨 결함 |
| **남은 것** | 이미 운영에 쌓인 기록이 있다면 갈라진 체인은 새 검증에서도 끊김으로 남는다(정말 갈라졌으므로 맞는 판정이다). 시각만 뒤집힌 기록은 새 검증으로 살아난다. 다음 화면 캡처(T-M5-56 다시 찍기)에서 증적 화면이 "끊김 없음" 으로 나오는지 함께 본다 |
| **상태** | 🟢 CLOSED — 재현 시험 → 수정 → 통과 (2026-10-01) |

---

## D-63. 빌려 쓰는 DB 연결이 끊기면 프로세스가 통째로 죽었다 — 처리되지 않은 pg 'error' 🔴

| | |
|---|---|
| **발견** | 2026-10-01 (화면 제품화 T-M5-56 의 캡처 준비 중 — 캡처 DB 를 다시 만들자 event-relay 가 `Connection terminated unexpectedly` 로 종료) |
| **충돌** | §B3·§A10 은 DB 재시작·장애 전환(T-M4-36 부하 중 Failover)에도 서비스가 스스로 회복하기를 요구한다. 그러나 pg 풀은 **쉬고 있는** 연결에만 오류 처리기를 붙인다. `Db.tx()`·리더 잠금(`withLeaderLock`)이 연결을 빌려 쓰는 동안 DB 가 그 연결을 끊으면 연결이 내는 `'error'` 이벤트를 받을 곳이 없어 Node 가 처리되지 않은 오류로 **프로세스를 끝냈다** — 트랜잭션 하나의 실패가 Pod 재시작이 된다 |
| **영향** | DB 장애 전환·재시작·관리자 종료 순간 트랜잭션 중이던 모든 서비스(대학 API·중계기·서류 워커)가 함께 죽을 수 있다. 접수 처리 중인 요청은 어차피 실패하지만, 다른 요청까지 끊기고 재기동 동안 접수가 멈춘다. 단일 노드·순차 시험에서는 드러나지 않았다 |
| **판정** | `Db.checkout()` — 연결을 빌릴 때 `'error'` 처리기를 붙이고 반납할 때 뗀다. `tx()` 와 리더 잠금이 이것을 쓴다. 끊긴 연결로 하던 일은 다음 쿼리에서 실패하고 반납 때 버려진다(`release(err)`), 풀은 새 연결로 계속 일한다 |
| **재현 시험** | `packages/server-kit/src/db.integration.test.ts` — 트랜잭션 중 다른 세션이 `pg_terminate_backend` 로 그 연결을 끊는다. **고치기 전: uncaughtException("terminating connection due to administrator command")**, 고친 뒤: 트랜잭션만 실패·uncaughtException 0·풀 정상 |
| **저장소 반영** | ✅ (2026-10-01) `server-kit/src/db.module.ts`·`admission-api/src/common/scheduling/leader-lock.ts`. 다섯 서비스 시험 실패 0. **실제 확인**: 캡처 서버 넷(중앙·대학·서류 워커·중계기)이 떠 있는 채 캡처 DB 를 지우고 다시 만들어도 넷 모두 살아 `/healthz` 200 |
| **노션 반영** | 해당 없음 — 설계 요구(스스로 회복)를 구현이 못 지킨 결함 |
| **상태** | 🟢 CLOSED — 재현 시험 → 수정 → 통과·실제 확인 (2026-10-01). K-PaaS 의 부하 중 DB Failover(T-M4-36)에서 다시 본다 |

---

## D-64. 계약의 권한 범위 이름과 노션 06 의 역할 이름이 다르고, 계약에 인증 실패 응답이 없다 🟡

| | |
|---|---|
| **발견** | 2026-10-03 (T-M5-02·10 단계 3 — 대학 API 에 OIDC 검증을 붙이며) |
| **충돌** | ① OpenAPI 는 운영 경로를 `security: [{ oidc: [admin] }]`·`[operator]`·`[auditor]` **범위 이름**으로 나눈다. 노션 06 은 **역할 6종**(platform-viewer·sre-operator·admission-admin·security-auditor·release-controller·break-glass)을 정의한다. 범위와 역할을 잇는 표가 어디에도 없다. 특히 `operator`(대사 예외 목록·대사 실행)는 이름만 보면 sre-operator 같지만, 노션 06 은 sre-operator 를 "scale/restart/log" 로, admission-admin 을 "업무 Config API" 로 정의한다 ② 계약에는 401(토큰 없음·틀림)·재인증 요구(RFC 9470 `WWW-Authenticate: Bearer error="insufficient_user_authentication"`)·503(발급자 키를 쓸 수 없음) 응답이 없다 |
| **판정** | ① **범위 → 역할**: `admin`·`operator` → admission-admin(대사도 입학처 업무), `auditor` → security-auditor. 나머지 넷은 업무 API 권한이 없다(K8s 전용). 코드 `apps/admission-api/src/common/identity/admin-scope.ts` `SCOPE_ROLES`, 경로마다 `@AdminScope` — `oidc-routes.test.ts` 가 계약 범위와 구조로 대조한다 ② 응답 code `UNAUTHENTICATED`(401)·`STEP_UP_REQUIRED`(401 + `WWW-Authenticate` 의 `acr_values`·`max_age`)·`AUTH_UNAVAILABLE`(503) 을 계약 패키지(`packages/contracts/src/problem.ts`)에 두었다. Problem 스키마는 code 를 열어 두어 지금 계약과 어긋나지 않는다 |
| **저장소 반영** | ✅ (2026-10-03) 대학 API `AUTH_MODE=oidc` — [docs/12 §6](12-authentication-plan.md) |
| **노션 반영** | ⬜ ① 노션 06 역할 절에 "계약 범위 → 역할" 표 ② OpenAPI 첨부에 공통 응답 `Unauthenticated`·`StepUpRequired`·`AuthUnavailable` 과 운영 경로의 401·403 — [06-notion-changeset.md](06-notion-changeset.md) 에 올릴 것 |
| **상태** | 🟡 저장소 반영, 노션 반영 대기 |

---

## D-65. 모집·전형·모집단위 조회가 지원자 토큰을 요구했다 — 로그인 전 화면·운영 콘솔이 볼 공개 정보 🟢

| | |
|---|---|
| **발견** | 2026-10-03 (T-M5-10 단계 5 — 운영 콘솔을 관리자 로그인으로 바꾸며. 콘솔 머리글이 지금 모집을 이 경로로 읽는다) |
| **충돌** | 계약(1.6.0)은 `getCurrentCycle`·`listAdmissionTypes`·`listDepartments` 에 전역 `oidc`(지원자 토큰)를 걸었다. 그러나 이 셋은 누구에게나 같은 공개 정보(모집 이름·마감·전형·모집단위 목록)이고, 지원자 화면은 로그인 전 첫 화면에서 마감을 보이고 전형을 고르게 한다. 운영 콘솔은 지원자 토큰이 없다(담당자 렐름) |
| **판정** | **공개로 둔다** — 계약 1.7.0 에서 세 경로에 `security: []`. 요구를 푸는 변경이라 호환이다(§A16). 개인정보가 없고, 원서·결제·서류는 그대로 지원자 토큰과 소유권 검사 뒤다. 코드 `PUBLIC_ROUTES`(oidc-auth.ts)·계약 대조 시험(`oidc-routes.test.ts`)이 같이 바뀐다 |
| **저장소 반영** | ✅ (2026-10-03) OpenAPI 1.7.0, 대학 API 공개 경로 |
| **노션 반영** | ⬜ OpenAPI 첨부 교체(1.7.0) — [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영, 노션 반영 대기 |

---

## D-66. 브라우저가 원서 저장(PATCH)·공통원서 저장(PUT)·서류 삭제(DELETE)를 보낼 수 없었다 — NestJS 11 의 CORS 기본 메서드 🔴

| | |
|---|---|
| **발견** | 2026-10-03 (T-M5-10 단계 5 — 콘솔 화면을 바꿔 접근성 시험을 다시 돌리다가 키보드 완주가 공통원서 저장에서 "서버에 연결할 수 없습니다" 로 멈췄다) |
| **원인** | 2026-10-02 보안 게이트(T-M5-20·22)에서 NestJS 10→11 로 올리며 `@fastify/cors` 가 11 이 됐다. 11 은 허용 메서드를 적지 않으면 **GET·HEAD·POST 만** 허용한다(전에는 PUT·PATCH·DELETE 포함). 대학·중앙 API 는 메서드를 적지 않았다. 서버 대 서버 시험·DAST 는 브라우저 사전 요청(preflight)을 하지 않아 못 잡았다 |
| **영향** | 그날부터 브라우저의 지원자 화면이 원서를 저장하지 못하고(PATCH), 공통원서를 저장하지 못하고(PUT), 올린 서류를 지우지 못했다(DELETE) — 접수 자체가 막힌다. CI·보안 게이트는 모두 초록이었다 |
| **판정** | 두 API 의 CORS 에 허용 메서드를 적는다(GET·HEAD·POST·PUT·PATCH·DELETE). 실제 조립(app.setup.ts)으로 사전 요청을 보내는 시험을 둔다 |
| **재현 시험** | `apps/admission-api/src/app.setup.test.ts`(PATCH·DELETE·POST·다른 오리진 거절)·`apps/central-api/src/app.setup.test.ts`(PUT). **고치기 전 빌드로 돌리면 PATCH·DELETE 가 실패**, 고친 뒤 통과. 띄워 둔 서버에서도 사전 요청 응답이 `access-control-allow-methods: GET,HEAD,POST` 였다 |
| **저장소 반영** | ✅ (2026-10-03) 두 API `app.setup.ts`. 키보드 완주가 다시 접수번호까지(키 92번) |
| **노션 반영** | 해당 없음 — 구현 결함 |
| **상태** | 🟢 CLOSED — 재현 시험 → 수정 → 통과 (2026-10-03) |

---

## D-67. 발급자가 끊기면 5분 뒤 지원자가 쫓겨난다 — 키 캐시만으로는 "이미 접속한 사람은 계속" 이 5분이다 🟡

| | |
|---|---|
| **발견** | 2026-10-03 (T-M5-02 단계 7 — JWKS 캐시 실증을 설계하며) |
| **충돌** | §01 A1 Autonomous Mode·T-M3-06 인수기준은 "중앙(IAM 포함)을 2시간 끊어도 작성·저장·결제 확인·최종제출 지속" 이다. 대학 API 의 JWKS 캐시는 **이미 받은 토큰의 서명**을 계속 검증하게 해 줄 뿐이다. 지원자 액세스 토큰은 5분이고, 갱신은 발급자에게 해야 한다. 발급자가 끊기면 5분 안에 모든 지원자의 토큰이 끝나고 화면은 로그인 끝으로 처리한다 — 키 캐시가 있어도 실제 지속 시간은 5분이다. 노션은 토큰 수명과 단절의 관계를 정하지 않았다 |
| **판정** | **지원자 토큰에 한해 "발급자 단절 유예"** — 대학 API 가 만료된 지원자 토큰을 아래가 **모두** 맞을 때만 받는다. 서명·발급자·대상(aud)·발급 시각 검사는 그대로다(만료 직전 시각으로 다시 검증) ① 발급자에 지금 닿지 않는다 — 공개키를 다시 받아 본다(쿨다운 30초에 한 번, 만료 토큰을 쏟아부어도 발급자를 두드리지 않는다). 닿으면 401, 화면이 갱신한다 — 평소 동작은 바뀌지 않는다 ② 만료된 지 유예(`OIDC_APPLICANT_OUTAGE_GRACE_MS`, 기본 **2시간** = 인수기준, 0 이면 끔) 안이다 ③ 발급자에 마지막으로 닿은 **뒤에** 만료됐다 — 단절 전에 이미 끝난 토큰(훔친 옛 토큰)은 발급자를 멈추게 해도 쓸 수 없다. **담당자 토큰에는 두지 않는다** — 운영 동작은 기다려도 되고, 민감 동작은 어차피 5분 안 재인증(MFA)이 필요하다. 화면은 갱신이 발급자에 닿지 못하면 쓰던 토큰을 만료 뒤에도 보낸다(30초 동안 갱신을 다시 시도하지 않는다) |
| **위험과 상쇄** | 발급자를 마비시키면 유예 안의 탈취 토큰 사용 시간이 늘어난다 — 그러나 ③으로 단절 전에 끝난 토큰은 제외되고, 유예 판정은 지표(`auth_decisions{result="grace"}`)·경고 로그(1분에 한 줄)로 보인다. 로그아웃한 사람의 액세스 토큰은 단절이 없어도 만료까지 쓸 수 있다(액세스 토큰은 폐기 조회를 하지 않는다) — 유예가 그 시간을 늘리는 것은 단절 중에만이다. 대학 자체 세션을 새로 발급하는 방식(토큰 교환)은 화면·두 API 의 신원 경로를 모두 바꿔야 해 택하지 않았다 |
| **재현 시험** | `packages/server-kit/src/oidc/verifier.test.ts` 「발급자 단절 유예」 7개(단절 중 받음·발급자 살아 있으면 401·유예 초과·단절 전 만료 토큰 거절·유예 중 위조 서명·다른 대상 거절·기본 끔·쿨다운). 실제 발급자 정지 실증 `npm run test:auth:offline` — [docs/12 §6 단계 7](12-authentication-plan.md) |
| **저장소 반영** | ✅ (2026-10-03) `server-kit` `OidcVerifier` `outageGraceMs`·`JwksCache.issuerReachable()`, 대학 API 지원자 검증기, 지원자 화면 `lib/auth.ts` |
| **노션 반영** | ⬜ §01 A1 「해결」 에 한 단락 — [06-notion-changeset.md](06-notion-changeset.md) |
| **상태** | 🟡 저장소 반영, 노션 반영 대기 |

---

<!--
신규 항목 템플릿

## D-N. <제목>

| | |
|---|---|
| **발견** | YYYY-MM-DD (M?) |
| **충돌** | A문서는 ~~~ / B문서는 ~~~ |
| **판정** | **채택안** — 근거 |
| **저장소 반영** | ⬜ |
| **노션 반영** | ✅ (2026-09-27) |
| **상태** | 🔴 OPEN |
-->
