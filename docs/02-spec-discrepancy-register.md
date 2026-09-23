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
| **노션 반영** | ⬜ v1.0 §6.2 예시 JSON 수정 필요 |
| **상태** | 🟡 판정완료 |

---

## D-2. 지원자 흐름 단계 수

| | |
|---|---|
| **발견** | 2026-09-22 (M0) |
| **충돌** | 개발보고서 PDF **5단계** / v1.0 §12.1 정보구조 **10항목** / v1.1 §07 Step Indicator **6단계** |
| **판정** | **6단계** — v1.1 §07이 KRDS 단계 표시기 권장 범위에 맞춰 정리한 최신 결정 |
| **6단계** | 공통정보 → 대학·전형 → 추가정보 → 서류 → 검토·결제 → 최종제출 (→ 완료) |
| **저장소 반영** | ✅ `apps/frontend/` 디렉터리 구조 + README |
| **노션 반영** | ⬜ v1.0 §12.1 정보구조를 6단계 기준으로 재정리 |
| **PDF 반영** | ⬜ 제출문서 정정 목록 |
| **상태** | 🟡 판정완료 |

---

## D-3. 백엔드 런타임

| | |
|---|---|
| **발견** | 2026-09-22 (M0) |
| **충돌** | 노션 v1.0 §4 "Java LTS + Spring Boot 계열" / 팀 실제 역량은 Node·TypeScript |
| **판정** | **NestJS + TypeScript (Node LTS)** — ADR-0001 참조 |
| **근거** | 설계서가 요구하는 실질은 ① ACID 트랜잭션 ② Outbox ③ 관측성 ④ 장기지원 런타임이며 Node LTS + PostgreSQL이 모두 충족 |
| **저장소 반영** | ✅ ADR-0001, 전 앱 스캐폴딩 |
| **노션 반영** | ⬜ v1.0 §4 기술 스택 표의 Backend 행 수정 |
| **PDF 반영** | ⬜ 개발보고서 "팀 기술 스택" 및 설계 서술 정정 |
| **상태** | 🟡 판정완료 |

---

## D-4. Finalized 이벤트의 sequence 위치

| | |
|---|---|
| **발견** | 2026-09-22 (M0) |
| **충돌** | v1.0 §6.2 최소 이벤트 payload에 sequence 없음 / v1.1 §A3·§04는 Application별 단조 증가 sequence 요구 |
| **판정** | **CloudEvents 확장 속성 `kadmissionsequence`로 전달** — data 본문에 넣지 않는다 |
| **근거** | v1.1 §04가 확장 속성 목록에 `kadmissionsequence`를 명시 |
| **저장소 반영** | ✅ `packages/contracts/src/events.ts` (`KAdmissionExtensions`) |
| **노션 반영** | ⬜ v1.0 §6.2 예시에 확장 속성 표기 추가 |
| **상태** | 🟡 판정완료 |

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
| **상태** | 🟡 부분 완료 |

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
| **노션 반영** | ⬜ v1.0 §5.6 상태 다이어그램에 취소 전이 추가 · §9 감사 액션 목록 · §03 OpenAPI 에 `POST /applications/{id}/cancel` · **접수 후 취소를 별도 레코드로 둘지 결정** |
| **상태** | 🟡 판정완료 — 노션 반영 대기 (접수 후 취소 설계는 여전히 열려 있다) |

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
| **상태** | 🟡 판정완료 — Postgres 어댑터에서 마무리 |

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
| **상태** | 🟡 판정완료 — 노션 §02·§03에 "생성은 자연키로 멱등" 명시 필요 |

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
| **노션 반영** | ⬜ 중앙 DDL 을 §04 또는 새 절의 첨부로 추가해야 한다. 그래야 다음부터 저장소가 원본이 되지 않는다 |
| **상태** | 🟡 판정완료 — 노션 첨부 추가 필요 |

---

## D-15. 접수번호가 중앙에 가는지 문서마다 다르다

| | |
|---|---|
| **발견** | 2026-09-22 (M2) |
| **충돌** | v1.0 §17.1 "중앙 기본 수집" 목록에 **접수번호가 없다** / canonical CloudEvents 스키마는 `ApplicationFinalizedData.required` 에 **`applicationNumber` 를 포함**한다 |
| **판정** | **첨부(CloudEvents 스키마)를 채택한다.** 판정 우선순위상 첨부가 본문 서술보다 위다 (§4) |
| **근거** | 내 원서 Dashboard 가 접수번호를 보여주려면 중앙에 있어야 한다. 접수번호는 지원자 본인에게 이미 노출되는 값이고, 무작위라 다른 지원자를 훑는 데 쓸 수 없다 (§09 BOLA 대응 완료) |
| **주의** | 그래도 접수번호는 **식별자**다. 중앙 로그·Metrics Label 에 넣지 않는다 |
| **노션 반영** | ⬜ v1.0 §17.1 의 중앙 수집 목록에 접수번호를 추가하고, 왜 포함되는지 한 줄 근거를 붙인다 |
| **상태** | 🟡 판정완료 |

---

## D-16. Support Self-check 가 필수 기능인데 OpenAPI 에 없다

| | |
|---|---|
| **발견** | 2026-09-22 (M2) |
| **충돌** | v1.1 §01 **C7 이 "Support Self-check"를 필수 신규 기능으로 규정**하고 §B11 이 장애 시 고객센터 폭주 완화 수단으로 지목한다. 그런데 canonical OpenAPI 의 Applicant API 16개 엔드포인트에 해당 경로가 없다 |
| **왜 중요한가** | 2026년 장애 때 지원자가 자기 상태를 확인할 길이 고객센터뿐이었다. "서버가 아는 상태"를 사용자가 직접 보는 것이 이 제품이 고치려는 지점이다 |
| **판정** | **구현한다.** 기능 요구(§01 C7)가 계약 누락보다 우선한다 |
| **구현 경로** | `GET /api/v1/applications/{applicationId}/self-check` |
| **노션 반영** | ⬜ §03 Applicant API 목록과 첨부 `k-admission-openapi.yaml` 에 추가해야 한다 |
| **상태** | 🟡 판정완료 — 계약 추가 대기 |

---

## D-17. Common Profile Vault 의 API 가 어디에도 정의되어 있지 않다

| | |
|---|---|
| **발견** | 2026-09-22 (M2, T-M1-09 착수) |
| **충돌** | v1.1 §10 §3 이 "대학이 중앙 Vault 에 필요 필드를 요청 → Profile Snapshot 수신" 흐름을 그림으로 규정한다. v1.0 §3.1 도 Common Profile Vault 를 중앙 구성요소로 명시한다. **그런데 이 호출의 API 계약이 OpenAPI 어디에도 없다** |
| **판정** | 중앙 내부 API 로 구현한다. `POST /internal/v1/profile-snapshots` |
| **저장 위치 결정** | v1.0 §5 가 "공통원서는 **Control Plane 과 분리된** Applicant Common Profile Vault 에서 관리한다"고 명시한다. 따라서 Sync Gateway 의 집계 DB(`kadmission_central`)와 **같은 스키마에 두지 않는다.** 별도 스키마 `kadmission_vault` 를 쓴다 |
| **운영 시** | 별도 DB 인스턴스 + 자체 KMS 로 분리한다. 한 스키마에 두면 §8.3 의 "Vault 가 새로운 개인정보 집중 위험이 되지 않도록 통제"가 깨진다 |
| **노션 반영** | ⬜ Vault API 계약을 §03 또는 §10 에 추가. 요청/응답 형태와 동의 범위 전달 방식을 정해야 한다 |
| **상태** | 🟡 판정완료 — 계약 추가 대기 |

---

## D-18. 중앙 장애 시 원서 "생성"이 가능한지가 불명확하다

| | |
|---|---|
| **발견** | 2026-09-22 (M2) |
| **문제** | §10 §1 표는 공통원서 프로필 행에서 "**Snapshot 생성 후** 작성·제출은 중앙과 무관"이라고 적는다. 즉 Snapshot 생성 **시점**에는 중앙이 필요하다. 그러면 중앙 장애 중에는 새 원서를 못 만드는가? |
| **같은 표의 다른 행** | 대학/전형 검색 행은 "중앙 검색 장애여도 **대학 직접 URL 접수 가능**"이라고 적는다. 새 원서 생성이 막히면 이 문장과 모순된다 |
| **판정** | **Snapshot 은 best-effort 다.** 중앙이 응답하지 않으면 빈 원서로 생성하고 사용자가 직접 입력한다. 생성 자체를 막지 않는다 |
| **근거** | 중앙은 편의 계층이다. 편의가 없다고 접수 기회를 잃으면 이 제품의 전제가 무너진다 |
| **노션 반영** | ⬜ §10 §1 표에 "중앙 장애 시 신규 원서는 Snapshot 없이 생성" 을 명시 |
| **상태** | 🟡 판정완료 |

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
| **노션 반영** | ⬜ §03 Applicant API 에 추가하고 첨부 yaml 갱신. 또는 `AdmissionType` 에 `formSchema` 를 싣는 방식 중 택일 |
| **상태** | 🟡 판정완료 — 계약 추가 대기 |

---

## D-20. AV 검사 워커용 내부 API 가 계약에 없다

| | |
|---|---|
| **발견** | 2026-09-23 (M2, 서류 파이프라인) |
| **문제** | v1.0 §5.4 는 "악성코드 검사 완료 전 QUARANTINED, 통과 후 AVAILABLE" 을 규정한다. 그런데 **검사 워커가 결과를 보고할 경로가 계약에 없다.** 그러면 서류는 영원히 QUARANTINED 에 머물고, 접수 확정이 AVAILABLE 기준이므로 필수서류가 있는 전형은 접수가 끝나지 않는다 |
| **판정** | 내부 API 를 추가한다 — `GET /internal/v1/documents/pending-scan`, `POST /internal/v1/documents/{id}/scan-result` |
| **왜 워커가 DB 를 직접 고치지 않는가** | 서류 상태의 원장은 대학 DB 이고 상태 전이 규칙은 `admission-api` 한 곳에만 있어야 한다. 워커가 DB 를 직접 쓰면 규칙이 두 곳에 생긴다 (ADR-0004) |
| **노션 반영** | ⬜ §03 Internal API 에 추가하고 첨부 yaml 갱신 |
| **상태** | 🟡 판정완료 — 계약 추가 대기 |

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
| **노션 반영** | ⬜ §02 첨부 DDL 에 0002 내용을 접어 넣고 이 파일을 삭제한다. **반영 전까지 마이그레이션이 두 파일로 나뉜다** |
| **상태** | 🟡 저장소 해소 — 노션 반영 대기 |

---

## D-22. Deadline Policy 에 활성화 API 가 없다

| | |
|---|---|
| **발견** | 2026-09-23 (M3) |
| **충돌** | DDL `deadline_policy.activated_at` 이 존재하고 v1.1 §A2 는 "정책은 입학처 **2인 승인 후 활성화**한다"고 규정한다. 그런데 OpenAPI 에는 `POST /admin/v1/deadline-policies` 와 `.../approve` 만 있고 **activate 가 없다.** Config 쪽에는 activate 가 있다 |
| **문제** | 승인과 활성화를 분리한 이유는 §A14 의 "활성화 예약시간" 때문이다. 승인 즉시 적용되면 마감정책이 의도치 않은 시점에 바뀐다 |
| **판정** | `POST /admin/v1/deadline-policies/{policyId}/activate` 를 추가한다. Config 와 대칭을 맞춘다 |
| **노션 반영** | ⬜ §03 과 첨부 yaml 에 추가 |
| **상태** | 🟡 판정완료 — 계약 추가 대기 |

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
| **노션 반영** | ⬜ §02 첨부 DDL 수정 |
| **상태** | 🟡 판정완료 — DDL 변경 제안 |

---

## D-24. Evidence Package 조회에 사유 파라미터가 없다

| | |
|---|---|
| **발견** | 2026-09-23 (M3, Evidence Package 구현) |
| **문제** | v1.0 §8.3 은 "민감정보 조회는 **목적·사유 입력 및 별도 Audit**" 를 요구한다. §B16 도 운영자 보정에 reason/ticket 을 요구한다. 그런데 canonical OpenAPI 의 `getEvidencePackage` 는 `applicationId` 만 받는다. **사유 없이 열람할 수 있다** |
| **왜 중요한가** | Evidence Package 는 한 지원자의 접수 과정 전체를 담는다. 사유 없이 누구나 열어볼 수 있으면 §09 Information Disclosure 의 "운영자 과권한" 이 그대로 열린다 |
| **판정** | `?reason=` 을 필수로 받는다. 비어 있으면 400. 열람 사실을 `ADMIN_VIEWED_PII` 감사 이벤트로 남긴다 |
| **노션 반영** | ⬜ §03 과 첨부 yaml 에 reason 파라미터 추가 |
| **상태** | 🟡 판정완료 — 계약 추가 대기 |

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
| **노션 반영** | ⬜ §02 첨부 DDL 에 추가 |
| **상태** | 🟡 저장소 해소 — 노션 반영 대기 |

---

## D-26. Reconciliation 수동 실행 경로가 계약에 없다

| | |
|---|---|
| **발견** | 2026-09-23 (M3) |
| **문제** | §B18 은 "D+1 에 자동 대조" 를 규정하고 OpenAPI 는 목록 조회와 해소만 제공한다. **대조를 지금 돌리는 경로가 없다** |
| **왜 필요한가** | 장애 대응 중에는 다음 배치를 기다릴 수 없다. SEV1 런북의 `Reconciliation` 단계(§14.3)는 즉시 실행을 전제로 한다. 배치 주기가 하루면 그 사이 운영자는 상태를 확인할 방법이 없다 |
| **판정** | `POST /admin/v1/reconciliation/run` 추가 |
| **노션 반영** | ⬜ §03 과 첨부 yaml 에 추가 |
| **상태** | 🟡 판정완료 — 계약 추가 대기 |

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
| **노션 반영** | ⬜ §04 이벤트 스키마와 §10 §9 Dashboard 계약에 반영. **중앙에 가명 식별자를 두는 결정이라 §A3 과 함께 재검토해야 한다** |
| **상태** | 🟡 저장소 해소 — 노션 확인 필요 (설계 결정이 걸려 있다) |

---

## D-28. 지원자 API 에 소유권 검사가 없었다 🔴

| | |
|---|---|
| **발견** | 2026-09-23 (프로덕션 점검) |
| **문제** | 조회·수정 경로 전부가 `applicationId` 만으로 동작했다. `x-applicant-id` 는 **감사 기록의 actor 로만** 쓰였고 인가에는 전혀 쓰이지 않았다. 헤더를 바꾸면 남의 원서를 읽고, 자기소개서를 덮어쓰고, 서류를 지우고, 최종접수까지 할 수 있었다 |
| **영향 경로** | `GET /applications/{id}` · `PATCH /applications/{id}` · `POST /{id}/validate` · `GET /{id}/form-schema` · `GET /payments/{id}` · `POST /payments/{id}/verify` · `GET /{id}/submission` · `GET /submissions/{id}/receipt` · `POST /documents/{id}/complete` · `DELETE /documents/{id}` |
| **왜 계약만 봐서는 안 잡히나** | OpenAPI 는 `security: [{ oidc: [] }]` 로 "인증"을 규정하지만 **인가는 규정하지 않는다.** 인증만 붙이면 로그인한 지원자 전원이 서로의 원서를 볼 수 있다. 계약이 맞아도 제품이 틀릴 수 있는 자리다 |
| **판정** | 자원마다 소유자를 확인한다. 없는 자원과 남의 자원을 **같은 응답**으로 돌려준다 — 구분해 주면 식별자를 훑어 유효한 원서를 찾아낼 수 있다 |
| **저장소 반영** | ✅ `common/identity/ownership.service.ts` + 전 경로 적용 · 통합 테스트 6종 |
| **노션 반영** | ⬜ §03 에 소유권 규칙을 명시하고, §09 STRIDE 의 Information Disclosure 항목에 이 경로를 추가 |
| **상태** | 🟡 저장소 해소 — 노션 반영 대기 |

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
| **노션 반영** | ⬜ §02 첨부 DDL 의 `application` 자연키를 부분 유니크로 변경 |
| **상태** | 🟡 저장소 해소 — 노션 확인 필요 (제약 약화 변경) |

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
| **노션 반영** | ⬜ |
| **상태** | 🔴 OPEN |
-->
