# 노션 반영 변경안 — 승인 대기 (2026-09-30)

> 저장소는 이미 바뀌었고, **노션만 남았다.** 2026-09-30 에 AI 가 노션 페이지를 고치려 했으나 권한 분류기가
> 외부 시스템 쓰기로 막았다. 노션 수정은 사용자가 직접 하거나, AI 에게 노션 쓰기를 허용한 뒤 이 문서대로 적용한다(R6).
> 적용한 조각은 [불일치 대장](02-spec-discrepancy-register.md) 해당 항목의 "노션 반영" 을 `✅ (날짜)` 로 바꾼다.

## 첨부 교체 — 저장소 파일을 **그대로** 올린다 (R5)

올린 뒤 노션에서 내려받은 파일의 바이트 수·SHA-256 이 아래와 같아야 한다.

| 노션 문서 | 첨부 이름 | 저장소 파일 | 바이트 | SHA-256 | 근거 |
|---|---|---|---|---|---|
| [§03 OpenAPI](https://app.notion.com/p/3df75ab5debe81588b56fcd81e7b3856) | `k-admission-openapi.yaml` | `packages/contracts/openapi/k-admission.v1.yaml` (v1.17.0) | 123,761 | `42608e4534e8aca88110d72c24205774e9a16b0d38cddccafa7e648dfcbd7578` | D-51 · D-55 ~ D-61 · T-M5-51 · T-M5-56 · D-65 · D-78 · D-79 · D-80 · D-81 · D-82 · D-84 · D-85 · D-86 |
| [§04 CloudEvents](https://app.notion.com/p/3df75ab5debe81d68e37fabd3678dcc4) | `k-admission-cloudevents-schemas.json` | `packages/contracts/events/k-admission-cloudevents.schema.json` | 6,104 | `3ed7ec8a340c50f6e7de25b2c3322ffd7c6b4914fd046afdc67a2efea699ca02` | D-47 · T-M5-51 |
| [§05 Helm](https://app.notion.com/p/3df75ab5debe811cac32ec1c98d50d59) | `k-admission-values-m.yaml` | `deploy/charts/k-admission/values-m.yaml` (v1.2) | 4,036 | `1aaef0db712e1d9a15da41fb86b7832a3da8c6decfdcd5992a57bb071e5b1975` | D-44 · D-49 · D-52 |
| [§05 Helm](https://app.notion.com/p/3df75ab5debe811cac32ec1c98d50d59) | `k-admission-runtime.yaml` | `deploy/platform/policies/runtime.yaml` (v1.5, 차트 렌더링 — RBAC 6종·내부 상호 TLS·서류 워커 출구) | 40,216 | `28c54fbdb2e83edc849526c06c7158017110fa0e24a3b3cbfe8f525febf2b315` | D-44 · D-52 · D-68 · D-69 |
| [§07 KRDS](https://app.notion.com/p/3df75ab5debe812db3d1e06d0761e38e) | `k-admission-krds-wireframe.html` | `docs/spec-assets/krds-wireframe.html` (v1.2) | 8,548 | `698d3abda827340f3abd40fceeb8b7ae63d7e2a6ea8d0e707d3cf4308562995e` | D-43 |

파일을 다시 고치면 이 표의 바이트·해시도 다시 적는다:
`for f in <파일들>; do wc -c <$f; sha256sum $f; done`

## 본문 수정

### 기술설계서 v1.0 본문

§17 Privacy 에 더한다 (D-84):

> 정보주체 권리 요청 — 대학 원서의 열람·정정·삭제·처리정지는 지원자가 원서 화면에서 요청하고, 대학 DB 에 요청번호(`PR-YYYYMMDD-XXXXXX`)·받은 시각·
> 법정 기한(받은 날부터 10일)과 함께 남는다. 요청 내용·회신은 원서 데이터 키로 봉한다. 입학처는 처리 큐에서 기한 순으로 보고, 한 건을 열면 담당자 열람이
> 감사 체인에 남는다. 결과는 한 번만 회신하고(일부 처리·거절은 사유 필수), 회신은 지원자 화면에 보인다. **실제 정정·삭제·처리정지는 입학처가
> 대학 규정과 보존 의무(접수 원서 10년 등)를 따져 한다** — 시스템이 요청만 보고 접수 원서를 지우지 않는다. 동의 철회·공통원서 삭제는 지원자가 바로 한다.

§17 Privacy 에 더한다 (D-82):

> 공통원서는 운영기관이 처리자다 — 저장할 때마다 공통원서 수집·이용 문안(판)에 동의를 받고 판·문안 해시·시각을 금고에 남긴다(없으면 저장하지 않는다).
> 대학 제공 동의 화면에는 제공받는 자·이용 목적·제공 항목·보유 기간(대학 처리방침)·거부할 권리를 함께 보인다(보호법 제17조 ②).

(이 문단만 **v1.1** 문서) §01 A15 Retention Matrix 표의 "지원자 신원정보"·"제출 서류 파일" 두 행을 넷으로 바꾼다 (D-87):

> 지원자 신원정보 — 접수하지 않은 지원자: 대학 규정(명시 필수) / 접수한 지원자: 입시관리업무 기록물 10년 하한, 접수 원서보다 먼저 파기 금지.
> 제출 서류 파일 — 접수하지 않은 원서: 대학 규정 / 접수한 원서: 대학 기록관리 규정(명시 필수, 파일을 지워도 해시는 남는다).
> "접수" 는 그 모집에 접수 완료 원서가 있는 것이다. 미접수자 정보를 접수 원서의 10년에 묶지 않는다(보호법 제21조 ③ 분리 보관).

§12.1 ① 접수 홈에 더한다 (D-86):

> 전형·모집단위를 고른 뒤 「지원 전 확인」 — 대학 고지 `notices.applicationRules`(수시 지원 횟수·정시 군별 지원·수시 합격자 정시 지원 금지·이중등록 금지와 위반 시 입학 무효,
> 대교협 지원 자료 제출)를 보이고 확인 체크를 받아야 원서를 시작한다(고등교육법 시행령 제42조·제42조의2). 확인은 새 원서의 감사 기록에 문안 해시와 함께 남는다.
> 서버는 확인을 강제하지 않는다(안내·확인이지 동의가 아니다). 지원 횟수 실제 대조는 대교협 연계(§20)의 몫이다.

§8.3 에 더한다 (D-85):

> 민감정보 서류(장애·건강 — 장애인 증명서·진단서·입원확인서 등)는 전형 설정 `sensitiveDocuments`(서류 종류 → 별도 동의 코드)로 표시한다. 별도 동의 문안은
> `consents` 에 필수 아님으로 둔다(해당 서류를 내는 지원자만 동의, 보호법 제23조). 그 동의가 없으면 그 서류의 업로드 URL 을 주지 않고, 서류가 원서에 있는 동안
> 동의가 없으면 최종 검증·결제 전 확인이 거절한다. 설정 검사는 문안 없는 동의를 거절하고, 민감해 보이는 서류에 표시가 없으면 경고한다.
> 증적 열람 기록에 민감정보 서류 수를 남긴다.

§8.3 「동의 기록」 에 더한다 (D-81):

> 원서 동의(개인정보 수집·이용, 학생부·수능 온라인 제공 등)의 문안은 전형 설정 `consents`(코드·제목·전문·필수 여부·판)로 2인 승인한다.
> 동의는 원서마다 (원서, 코드, 판) 한 줄과 문안 SHA-256 으로 남고, 동의·철회마다 감사 기록을 남긴다. 문안 판이 바뀌면 다시 받는다.
> 필수 동의가 없으면 최종 검증 오류이고 결제창을 열지 않는다. 결제를 시작한 원서는 동의를 바꿀 수 없다.

§5.6 상태머신 (D-55) — 전이 설명에 더한다:

> 누가 옮기는가 — 최종 검증 통과 `DRAFT → READY`, 저장 `READY → DRAFT`, 결제 의도 `READY → PAYMENT_PENDING`(이후 원서·서류 수정 불가),
> 결제 확정 `PAYMENT_PENDING → PAID`, 결제 실패·취소 `PAYMENT_PENDING → READY`, Finalize 트랜잭션 `PAID → FINALIZED`.
> **FINALIZING 은 DB 에 남지 않는다** — §02 8단계 Finalize 가 한 트랜잭션이라 커밋 전에만 존재하고, 실패는 롤백(= PAID 유지, "FINALIZING → PAID" 와 같다).
> 다단계 확정을 붙일 때를 위해 상태는 둔다. `EXPIRED` 는 모집 종료(주기 CLOSED) 처리와 함께 정한다 — 마감 연장(§B17)이 있어 마감 시각에 옮기면 되돌릴 수 없다.
> **한 원서에 살아 있는 결제는 하나다** — 열린 결제창은 다시 열고, 확인 중·확정 결제가 있으면 새 결제를 거절한다(이중 결제 방지, §B4).

§5 공통원서 (D-57) — 한 문단 더한다:

> 공통원서 **표준 항목**은 플랫폼이 정한다(출신 고등학교·졸업(예정) 연도·이메일·휴대전화). Vault 는 표준 항목만 저장하고, 대학 양식은 속성에
> `"x-profile": true` 를 단 항목을 공통원서에서 가져온다. 지원자는 중앙 공통원서 화면에서 쓰고 대학별 제공 동의를 준다 — 동의를 빼면 철회 기록이 남고,
> 이미 만든 원서의 사본은 바뀌지 않는다.

### §01 운영 리스크·설계 결함

- **A1** 「해결」 아래에 더한다 (D-67):

  > 발급자 단절 유예 — 중앙 IAM 이 끊기면 지원자는 토큰을 갱신할 수 없다. 대학 API 는 마지막으로 받은 공개키로 계속 검증하고(JWKS 캐시·디스크 스냅숏),
  > 만료된 **지원자** 토큰을 발급자에 닿지 않는 동안·만료 2시간 안·발급자에 마지막으로 닿은 뒤 만료된 것에 한해 받는다(서명·발급자·대상은 그대로 검사).
  > 담당자 토큰에는 유예가 없다. 유예로 받은 요청은 지표로 센다.
- **A5** 「기능」의 Config Linter 에 붙인다: "초안을 만들 때 런타임과 같은 엔진으로 양식 JSON Schema 를 컴파일하고 서류 목록 형식을 본다 — 적용하면 실패할 설정은 초안조차 만들지 않고, 모르는 전형 코드·이름 없는 항목은 승인 화면(Diff)에 경고한다 (D-56)"
- **A9** 「해결」 아래에 더한다 (D-61):

  > 구현 — 두 독립 시각원(노드의 NTP 동기 시계·DB 서버 시계)을 10초마다 대조한다(왕복이 가장 짧은 표본, 불확실성 = 왕복/2). 접수 커밋 시각은 트랜잭션 안에서 DB 에 묻고,
  > DB 밖에서 쓰는 시각(요청 수신·화면 표시·감사)은 측정 offset 으로 DB 시계에 맞춘다. 불확실성을 빼고도 1초를 넘은 노드는 **Finalize 만** 503 으로 거절한다 —
  > 트래픽 전체에서 빼면 작성·저장까지 줄어든다. 접수 기록·감사에 offset·불확실성·상태를 남긴다. DB 서버 자체의 시각 동기 감시는 인프라 요구다.
- **B4** 끝에 붙인다: "결제창은 원서마다 하나만 열린다 — 다시 누르면 같은 결제창, 확인 중·확정 결제가 있으면 새 결제를 거절한다. 결제창만 열린 채 콜백이 유실된 승인 결제는 PG 정산 목록 대조가 찾아 접수까지 잇는다 (D-55)"

### §01 운영 리스크 — A11 감사 분리 저장소 (D-75)

A11 대응에 더한다:

> 감사 기록은 DB 밖 Object Lock(COMPLIANCE) 버킷에도 남긴다. 5분마다 (시각, id) 순서의 조각으로 내보내고 보관 기간(기본 5년)을 건다.
> 보관 동안은 루트 계정도 지우지 못한다. 대조 작업이 조각과 DB 를 맞춰 지워진 기록·고쳐진 기록을 찾는다(DB 슈퍼유저 변조 대응).
> values-m 에 `objectStorage.auditWormBucket` 을 더한다 — 운영은 필수다.

### §01 운영 리스크 — A10 단일 Writer (D-76)

A10 대응과 DR 런북의 승격 순서에 더한다:

> 승격 순서: ① 대기 DB `pg_promote()` ② 새 Primary 에서 `SELECT kadmission.promote_writer(<지금 세대 + 1>, '<담당자>')` — 세대는 하나씩만 오르고, 동시에 둘이 승격하지 못한다
> ③ 앱의 `WRITER_EPOCH` 를 새 세대로 배포(GitOps). 그 사이 쓰기는 503 재시도 안내로 멈춘다(안전한 쪽).
> 옛 Primary 가 돌아와도 세대가 옛 값이라 새 세대를 아는 앱의 쓰기를 DB 트리거가 거절한다. 운영은 `writer_fence.require_token` 을 켠다.

### §01 운영 리스크 — A5 Config 호환 시험 (D-77)

A5 대응에 더한다:

> 새 설정은 적용 직전에 이 주기의 진행 중 원서를 새 양식으로 검사한다(작성 중은 저장된 값만, 검증 끝·결제 중·결제 완료는 필수까지).
> 하나라도 깨지면 적용하지 않는다. 승인 화면에도 미리 경고한다.

### §01 운영 리스크 — B11 대학별 장애 안내 (D-78)

B11 대응에 더한다:

> 장애 공지는 중앙이 아니라 **각 대학 Data Plane**이 소유한다. 대학 DB의 추가 전용 `service_incident` 원장에 지원자용 제목·안내, 영향 수준(`NOTICE`·`DEGRADED`·`OUTAGE`), 시작/예상 해제 시각, 발행·해제 담당자를 남긴다. 공개 상태 API는 대학 이름·전체 상태·활성 공지만 반환하며 내부 원인·구성·개인정보는 반환하지 않는다. 따라서 중앙이 끊겨도 대학 API가 살아 있는 동안 대학별 안내는 유지된다.
> 운영자 `operator`만 공지를 발행·해제할 수 있고, 변경 요청은 멱등 키·5분 이내 Step-up·감사 체인을 거친다. 공지 삭제나 본문 덮어쓰기는 허용하지 않고 해제만 한다. 지원자 웹은 모든 화면의 전역 배너와 `/status`에서 같은 공개 상태를 보여 준다.

### §01 운영 리스크 — B11 자동 증적번호·PII 최소 Support View (D-79)

B11 대응에 더한다:

> 상담원은 **이름·생년월일·연락처·원서 UUID 로 원서를 찾지 않는다.** 접수번호, 또는 원서마다 대학 DB 가 만드는 **상담 확인번호**(Crockford base32 10자,
> 화면 표기 `XXXXX-XXXXX`, 원서가 사는 동안 바뀌지 않음)로 찾는다. 지원자는 자기 상태 확인·검토·접수 완료·장애 안내 화면에서 이 번호를 본다.
> 응답은 **허용 목록으로만** 만든다 — 증적번호·조회 시각·대학/모집 이름·원서 상태와 한 줄 안내·마지막 저장·접수 여부/접수번호/접수 시각·결제 상태/금액/요청·확인 시각·
> 서류 상태별 개수·중앙 반영(대기·완료)·처리 이력(동작·결과·시각, 행위자 없음)·마감 시각·활성 장애 공지·상담 안내 문장. 원서 항목 값·공통원서·서류 종류/파일 이름·
> 이름/연락처·내부 식별자·결제사 거래번호·전형/모집단위는 응답에 없다(화면에서 숨기는 것이 아니다).
> 조회할 때마다 **증적번호** `SR-YYYYMMDD-XXXXXX`(한국 날짜)를 만들고, 그 순간 보인 응답 전체와 SHA-256 을 추가 전용 `support_lookup` 에 남긴다(담당자·문의 분류·찾은 번호 종류).
> 같은 트랜잭션에서 원서 감사 체인에 `SUPPORT_LOOKUP` 을 잇는다 — 지원자의 처리 이력에 "상담 조회" 로 보인다. 증적번호로 그때 안내한 내용을 그대로 다시 열고 무결성을 확인한다.
> 문의 분류는 고르는 값(접수 여부·결제·서류·장애 중·그 밖)이며 자유 문장을 받지 않는다(상담원이 개인정보를 기록에 적지 않게). 상담 담당 역할은 비밀번호+OTP 로그인만 요구하고 Step-up 은 두지 않는다.

### §02 PostgreSQL ERD

첨부 DDL(`0001_init.sql` v1.2)은 그대로 두고 본문 「정합성 규칙」 아래에 더한다 (D-70 — 저장소 마이그레이션 `0003_field_encryption.sql`, 중앙 `0004_vault_encryption.sql`):

> 원서 항목 값은 **암호문으로만** 저장한다 — 원서마다 데이터 키(DEK), 값은 AES-256-GCM(`application_field_value.value_ciphertext`, 원서·항목에 묶음),
> DEK 는 키 암호화 키(KEK)로 감싸 `application_data_key(application_id, kek_version, wrapped_dek)` 에 둔다. KEK 는 DB 밖(Vault Transit).
> `value_json` 은 암호화 전 행 이전용으로 NULL 허용, 한 행은 평문·암호문 중 하나만. 감사 역할은 감싼 키를 읽지 않는다.
> 중앙 공통원서 금고도 같다(`fields_ciphertext`·`wrapped_dek`, `key_version` = KEK ID). KEK 교체는 감싼 DEK 만 다시 감싼다(값은 그대로).
> DB 비상 접속 기록 `break_glass_access(db_user, valid_until, issued_at)` — 추가만(트리거), 앱은 읽지도 쓰지도 않는다(저장소 마이그레이션 0004, D-72).
> Outbox 보관 `outbox_event_archive` — `created_at` 월별 파티션, 영수증 열을 펼쳐 둔다. 전송·확인이 끝나고 7일 지난 이벤트를 옮기되 원서마다 마지막 순번은 남긴다(순번이 이어진다).
> 13개월이 지난 달은 파티션째 지운다(§01 B7 디스크 고갈 방지). 바로 쓰는 `outbox_event` 는 유니크(aggregate_id, aggregate_sequence) 때문에 파티션하지 않는다(저장소 마이그레이션 0005, D-74).
> 상담 확인번호 `application.support_code`(Crockford base32 10자, 유니크, 바꿀 수 없음)와 상담 증적 `support_lookup(evidence_number, application_id, lookup_kind, reason, agent_id, looked_up_at, snapshot, snapshot_hash)` — 추가만(트리거), 앱은 넣고 읽기만(저장소 마이그레이션 `0008_support_view.sql`, D-79).
> 정보주체 권리 요청 `privacy_request(request_number, application_id, kind, detail_ciphertext, status, received_at, due_at, decided_at, decided_by, result_note_ciphertext)` —
> 같은 원서·종류의 처리 중 요청은 하나(부분 유니크), 회신은 처리 중 → 결과 한 번(트리거), 내용·받은 시각·기한 변경과 삭제는 거절, 앱은 결과 칸만 UPDATE(저장소 마이그레이션 `0009_privacy_request.sql`, D-84).
> 장애 공지 원장 `service_incident` 는 대학 Data Plane에 둔다(저장소 마이그레이션 `0007_service_incident.sql`, D-78). 상태는 `ACTIVE`에서 `RESOLVED`로만 바뀌고 제목·안내·수준·시각·발행자는 수정하지 못한다. 앱 역할에는 조회·추가·해제용 UPDATE만 주며 DELETE·TRUNCATE 권한은 주지 않는다.

v1.0 §8.3 「고위험 필드 별도 암호화」 에 한 줄 더한다:

> 대학이 설정으로 항목을 더하므로 "고위험" 을 고르지 않고 **원서 항목 값 전부**를 암호화한다. 키가 없으면 읽기를 멈춘다(빈 값·평문으로 대신하지 않는다).

### §03 OpenAPI 계약

「첨부」 절 끝에 한 줄 더한다:

> **2026-09-30 v1.3.0** — 지원자 오퍼레이션 공통 `429`(`RateLimited`: Problem `code: RATE_LIMITED` + `Retry-After` 초)를 더했다.
> 한도는 IP 가 아니라 인증된 지원자·요청 종류 단위다(ADR-0007). optional 응답 추가라 호환 변경이다(§A16). (D-51)

> **2026-09-30 v1.4.0** — 구현에 있었지만 계약이 설명하지 않던 것을 적었다(D-55 ~ D-61). 결제 의도 `200`(열린 결제창 재사용)·`409 PAYMENT_IN_PROGRESS`,
> 원서 상태 전이 설명, FormSchema `profileFields`·`documents`, Self-check `payment.paymentId`, 현재 모집 `universityName`, 접수증 발급 감사,
> 검사 대기 `downloadUrl`·검사 결과 `signature`, `/healthz/dependencies` 의 `clock`, ConfigDiff `warnings`, 현재 설정 본문, 중앙 공통원서 `GET·PUT /api/v1/profile`,
> 이벤트 수신 규칙(`(source,id)` 중복 제거·미등록 대학 400·심장박동), "내 원서" 대학별 `universityReachable`. 전부 optional 필드·새 경로라 호환 변경이다(§A16).

> **2026-10-01 v1.5.0** — 화면이 내부 코드를 보이지 않게 표시 이름을 더했다(T-M5-51). "내 원서" 요약 `admissionTypeName`·`departmentName`(대학이 접수 알림에 싣는다),
> 공통원서 동의 `universityName`. optional 필드 추가라 호환 변경이다(§A16).

> **2026-10-01 v1.6.0** — 접수증 응답에 `admissionTypeName`·`departmentName`·`status`(T-M2-11 접수증 항목), Self-check 결제에 `requestedAt`(결제 확인 중 화면). 추가만이라 호환 변경이다(§A16). (T-M5-56)

> **2026-10-03 v1.7.0** — 지금 모집·전형·모집단위 조회를 공개(`security: []`)로. 누구에게나 같은 공개 정보이고 로그인 전 화면·운영 콘솔이 보인다. 요구를 푸는 변경이라 호환이다(§A16). (D-65)

> **2026-10-04 v1.8.0** — 대학 공개 상태 조회 `GET /api/v1/meta/service-status`와 운영자 장애 공지 목록·발행·해제 경로를 더했다. 공개 응답은 지원자용 정보만 포함하고, 운영 변경은 operator 범위·Step-up·멱등 키를 요구한다. 새 경로와 스키마 추가라 호환 변경이다(§A16). (D-78)

> **2026-10-04 v1.9.0** — 개인정보 최소 상담 조회 `POST /admin/v1/support/lookups`·`GET /admin/v1/support/lookups/{evidenceNumber}`(새 범위 `support`), 응답 `SupportView`(허용 목록),
> 지원자 Self-check 에 선택 필드 `supportCode`. 새 경로·범위·선택 필드 추가라 호환 변경이다(§A16). (D-79)

> **2026-10-04 v1.17.0** — 대학 고지에 선택 필드 `notices.applicationRules`(지원 횟수 제한·이중등록 금지·위반 시 입학 무효), 원서 생성 요청에 선택 필드 `rulesAcknowledged`(새 원서에 확인 감사와 문안 해시). 선택 필드라 호환 변경이다(§A16). (D-86)

> **2026-10-04 v1.16.0** — 형식 조회의 서류에 선택 필드 `sensitiveConsentCode`(민감정보 서류의 별도 동의). 그 동의 전 업로드 의도는 400, 서류가 있는데 동의가 없으면 검증 `CONSENT_REQUIRED`.
> 선택 필드이고 동작은 서류를 표시한 설정에만 적용돼 호환 변경이다(§A16). (D-85)

> **2026-10-04 v1.15.0** — 정보주체 권리 요청: 지원자 `POST·GET /api/v1/applications/{id}/privacy-requests`(같은 종류 처리 중 요청은 200 으로 그대로),
> 입학처 `GET /admin/v1/privacy-requests`(큐)·`GET …/{requestNumber}`(열람, 재인증·감사)·`POST …/{requestNumber}/decision`(회신 한 번, 재인증). 새 오퍼레이션이라 호환 변경이다(§A16). (D-84)

> **2026-10-04 v1.14.0** — 감사자 증적 패키지를 접수번호로 연다 `GET /admin/v1/evidence/by-number/{applicationNumber}`(같은 권한·재인증·사유·열람 기록). 새 오퍼레이션이라 호환 변경이다(§A16). (U-51)

> **2026-10-04 v1.13.0** — 공통원서 삭제 `DELETE /api/v1/profile`(값·데이터 키·대학별 제공 동의 삭제, 값 없는 발급 증적은 남김). 새 오퍼레이션이라 호환 변경이다(§A16). (D-82)

> **2026-10-04 v1.12.0** — 공통원서 저장 본문 `collectionConsentVersion`(지금 판이 아니면 400), 응답 `collectionConsent`. 스키마는 선택 필드라 호환이고 값은 서버가 강제한다(§A16). (D-82)

> **2026-10-04 v1.11.0** — 원서 동의: `PUT /api/v1/applications/{id}/consents`, 원서 생성 요청의 선택 필드 `consents`, 형식 조회 응답의 `consents`(문안·이 원서의 동의 여부),
> 검증 오류 코드 `CONSENT_REQUIRED`. 새 경로·선택 필드라 호환 변경이다(§A16). (D-81)

> **2026-10-04 v1.10.0** — 지금 모집 응답에 선택 필드 `notices`(개인정보 처리방침·위탁 공개 주소, 보호책임자, 문의처, 전형료 반환 안내 — 2인 승인된 설정에서). 선택 필드 추가라 호환 변경이다(§A16). (D-80)

### §04 CloudEvents Schema

- `subjectRef` 절의 패턴 `^[A-Za-z0-9_-]{1,64}[.][A-Za-z0-9_-]{43}$` → `^[A-Za-z0-9_-]{1,16}[.][A-Za-z0-9_-]{43}$`,
  뒤에 "— keyId 16자 이내(D-47). 전체 60자 이하라 중앙 `subject_ref varchar(64)` 에 들어간다" 를 붙인다
- 「첨부」 절에 "**2026-09-30** — keyId 상한을 16자로 좁힌 판으로 교체(D-47). 생성기와 중앙 DB 가 이미 16자라 기존 이벤트는 그대로 통과한다" 를 더한다
- 「첨부」 절에 "**2026-10-01** — `application.finalized` 에 선택 필드 `admissionTypeName`·`departmentName`(표시 이름, 개인정보 아님, 200자)을 더한 판(T-M5-51). 이름 없는 이벤트도 그대로 통과한다. 중앙은 스키마로 거르지 않으므로 배포 순서와 무관하다" 를 더한다
- 「이벤트 타입」 절에 더한다 (D-60 — 스키마 첨부는 그대로):

  > 대학이 보내는 것 — `application.finalized`·`application.cancelled`(Outbox, 원서 원장), `sync.heartbeat`(event-relay 가 기본 60초마다, Outbox 를 거치지 않는다 —
  > 중앙이 끊기면 건너뛴다). 중앙은 심장박동을 수신 원장·sequence gap 에 넣지 않고 대학의 "지금" 상태(적체·설정 버전·시계 offset·마지막 심장박동)를 덮어쓴다.
  > 심장박동이 180초 끊긴 대학은 "내 원서" 에서 확인 불가로 표시한다 — 접수 실패가 아니다.
  > **`payment.confirmed` 는 보내지 않는다** — 결제 확정이 곧 접수(D-42)라 접수 이벤트가 같은 사실을 전하고, 결제 금액·수단은 중앙이 알 필요가 없다(§A3 최소 정보).
  > `configversion`·`policyversion` 확장 속성은 접수 기록의 값이다(접수 전 취소에는 없다).

### §05 Kubernetes·Helm·GitOps

「Runtime 기준」 아래에 절을 더한다:

> **노드 장애 흡수 (D-52, ADR-0008)**
> - zone 분산은 `DoNotSchedule` + **`nodeTaintsPolicy: Honor`** + **`matchLabelKeys: [pod-template-hash]`** — 장애로 taint 된 노드를 분산 계산에서 빼야
>   zone 이 2개일 때도 대체 Pod·HPA 확장 Pod 가 살아 있는 zone 에 놓인다(기본값이면 zone 을 3개로 늘려도 막힌다). rollout 은 새 버전 Pod 끼리 분산을 센다
> - **계획 정비 뒤 재분산** — Honor 는 cordon 된 zone 도 빼므로 drain 동안 Pod 가 한 zone 에 모이고 저절로 다시 나뉘지 않는다. uncordon 뒤 rollout restart(또는 descheduler)
> - **PgBouncer 정상 종료** — preStop 10초 → SIGTERM(기존 클라이언트를 기다림), 앱 DB 풀은 연결을 사용 50회·idle 10초로 돌린다, grace 60초. 없으면 rolling restart 때 쓰던 연결이 SIGKILL 로 끊긴다
> - 노드 장애 판정 시간(`node-monitor-grace-period`)은 기본(약 50초) 대신 대학 SLO 에 맞춘다. 판정 전 구간은 Service 가 죽은 Pod 로 연결을 보낸다
> - **Edge(Gateway) 는 연결 실패·연결 시간 초과를 다른 엔드포인트로 1회 재시도한다** — 로컬 실측에서 남은 실패는 거의 다 죽은 Pod 로 간 연결 시간 초과였다.
>   모든 변경 요청에 Idempotency-Key 가 있어 POST/PATCH 도 안전하다
> - Edge 구현은 Gateway API 를 지원하는 유지보수 중인 컨트롤러로 한다 — ingress-nginx 는 2026년 3월 상위 프로젝트가 은퇴했다(D-53)

「첨부」 절을 바꾼다:

> `k-admission-values-m.yaml` — M Profile values (v1.2). `k-admission-runtime.yaml` — 차트 + values-m 의 **렌더링 결과**(v1.5).
> 손으로 쓰지 않는다: 차트나 values-m 을 고치고 `scripts/render-runtime-attachment.mjs` 로 다시 만든다(CI 가 드리프트를 막는다).
> v1.5(2026-10-03) — 서류 워커가 Object Storage 주소(S3_ENDPOINT)를 받아 그 호스트만 내려받는다(출구 허용 목록, T-M5-07).
> v1.4(2026-10-03) — 내부 경로 상호 TLS: 워크로드별 인증서 Secret·HTTPS 프로브·대학 API 서비스 443(D-69).
> v1.3(2026-10-03) — 역할 6종(security-auditor·break-glass 추가, D-68).
> v1.2 에서 바뀐 것 — NODE_ENV·포트 3001·프로브 `/healthz`·`/readyz`, 대조는 앱 안 스케줄러, 마감·설정 버전을 배포값에서 제거(2인 승인 우회 차단),
> Pod 당 커넥션 38(최대 391 ≤ 예산 400), Peak Mode 예약 시각은 비우고 `peak-schedule.yaml` 에서 온다(D-49), `nodeTaintsPolicy: Honor`·`matchLabelKeys`, PgBouncer 정상 종료(preStop·grace 60초).

「서류 검사 워커」 설명에 더한다 (D-58 — values-m·runtime 첨부는 그대로. 엔진은 대학 values 에서 켠다):

> 실 검사 엔진은 ClamAV 다(`documentService.scannerEngine: clamav`, `clamav.host`). 워커는 Object Storage 자격증명을 갖지 않고, 접수 API 가 검사 대기 목록에 싣는
> 파일 하나·몇 분짜리 서명 URL 로 읽어 clamd 로 흘려보낸다. clamav 일 때만 워커 출구(`scannerEgress` — clamd·Object Storage)가 열린다. clamd 배치(사이드카·공용 서비스)는 K-PaaS 착수 때 정한다.

### §06 NetworkPolicy·RBAC·Vault

「RBAC 역할」 목록 아래에 더한다 (D-68 — 첨부 `network-rbac.yaml` 의 예시 3종은 그대로, 6종의 기준은 차트 `templates/rbac.yaml`):

> Kubernetes 권한 — 모두 네임스페이스 한정, cluster-admin 없음.
> platform-viewer: Pod·로그·Deployment·Job·HPA 조회. sre-operator: 위 조회 + Deployment 규모 조정·재시작 — **Pod 구성(이미지·환경변수·볼륨·Secret 참조)은
> 바꿀 수 없다**(플랫폼 승인 정책. RBAC 만으로는 재시작 권한이 Secret 참조를 넣는 길이 된다). admission-admin: Kubernetes 권한 없음(Role·바인딩 없음).
> security-auditor: Role·바인딩·NetworkPolicy·ServiceAccount·Pod·Deployment·PDB·이벤트 조회 — Secret·로그·exec 없음.
> release-controller: 서명 검증된 GitOps 릴리스를 그 네임스페이스에만. break-glass: Role 만 두고 평소 바인딩 없음 — 켤 때는 끝나는 시각·사유를 함께,
> 서명 커밋·리뷰를 거친다. RBAC 변경·exec 는 비상 역할에도 없다.

「역할 정의」 표에 한 줄 더한다 (D-79 — 업무 역할이라 Kubernetes 권한·차트 변경은 없다):

> support-agent(상담 담당): 개인정보 최소 상담 조회만(접수번호·상담 확인번호로 상태 확인, 증적번호로 다시 보기). Kubernetes 권한 없음. 설정·대사·증적 패키지는 열지 못한다.
> 같은 조회를 admission-admin 도 할 수 있다(입학처가 직접 상담을 받는 경우).

「Secret」 절 아래에 더한다 (D-69):

> 서비스 간 통신 — 내부 경로(`/internal/**`)는 상호 TLS 로만. **워크로드 신원은 인증서 SAN URI** `spiffe://wonseoro/university/<대학ID>/<워크로드>`·`spiffe://wonseoro/central/<워크로드>`.
> 경로마다 부를 수 있는 워크로드를 정한다 — 중앙 이벤트 수신·영수증은 대학 Relay, 공통원서 스냅숏은 대학 API, 동기화 현황은 중앙, 대학 서류 검사 경로는 같은 대학 서류 워커.
> **요청 안의 대학은 인증서의 대학과 같아야 한다**(다른 대학 이름의 이벤트·남의 공통원서 요청은 403). 인증서는 짧은 TTL(24시간)로 쓰고 재기동 없이 교체한다.

「Vault」 절에 더한다 (T-M5-04, D-71 — 첨부 `vault-policy.hcl` 은 대학 API 정책의 예시로 두고, 워크로드별 줄을 더한다):

> 워크로드는 Kubernetes 인증(ServiceAccount 토큰, audience `vault`)으로 로그인한다. 역할은 `<대학>-<워크로드>` 이다.
> 정책도 워크로드마다 둔다. **PKI 역할은 워크로드마다** `pki/issue/kadmission-<대학>-<워크로드>`(자기 SAN URI 하나만) — 대학 단위 역할은 같은 대학의 서류 워커가 Relay 인증서를 받게 한다.
> 대학 API 는 첨부 정책대로 KV·DB 동적 계정(`database/creds/admission-api-<대학>`)·Transit(`pii-<대학>`, 필드 암호화 KEK)·자기 인증서를 받는다.
> Relay 는 Relay KV·DB 계정·자기 인증서만 받고, KEK 는 받지 않는다. 서류 워커는 자기 인증서만 받는다.
> 수명은 짧게 둔다 — 워크로드 인증서 24시간, DB 계정 1시간. 각각 수명의 2/3 이 지나면 새로 받는다. DB 계정을 바꿀 때는 새 계정으로 연결을 확인한 뒤 연결 풀을 바꾼다(무중단).
> 수명이 끝난 계정은 Vault 가 세션을 끊고 지운다 — 트랜잭션이 쓸 수 있는 여유는 수명의 1/3 이다.
> Transit 키를 돌리면 rewrap 으로 감싼 DEK 를 옮기고 `min_decryption_version` 을 올린다.

「RBAC 역할」 break-glass 항목에 더한다 (T-M5-03, D-72):

> 비상 역할은 끝나는 시각 전에만 배포된다 — 차트가 시각이 지난 바인딩을 렌더링하지 않아 GitOps 가 다음 조정 때 지우고, 그 사이는 매분 도는 회수 작업이 지운다.
> 켜져 있는 동안 회수 작업이 매분 Warning 이벤트(`BreakGlassActive`)와 경보 웹훅을 낸다. 회수하면 `BreakGlassRevoked` 를 낸다. 12시간 넘게는 켤 수 없다.
> DB 비상 접속은 Vault 의 `database/creds/break-glass-<대학>` 으로만 한다 — 비상 그룹만, 15분짜리 계정이다.
> 그 계정은 업무 표 읽기·고치기만 할 수 있고, DDL·감사 기록 수정은 할 수 없다. 발급하면 DB 의 `break_glass_access`(추가만)에 남고, 그 계정의 모든 문장은 서버 로그에 남는다.

「Edge」 또는 NetworkPolicy 설명에 한 줄 더한다 (첨부 `network-rbac.yaml` 은 K-PaaS Edge 확정 뒤 교체):

> 공개 트래픽 입구 선택자(edge 네임스페이스의 `ingress-nginx`)는 예시다. ingress-nginx 는 2026년 3월 은퇴해 보안 패치가 없으므로
> 운영은 Gateway API 를 지원하는 유지보수 중인 컨트롤러로 하고 선택자를 그에 맞춘다(D-53, ADR-0008).

### §09 STRIDE — 파일 업로드

「파일 업로드」 대응에 더한다 (T-M5-08, D-73):

> 서류는 PDF·JPG·PNG 만 받는다(magic-byte). Office 매크로 문서·압축 파일은 형식에서 거절한다.
> 검사 엔진은 clamd(공식 서명 DB)를 쓰고, 한도를 넘는 압축 해제는 경보로 거절한다(Zip·PDF 폭탄, `AlertExceedsMax`).
> 스스로 움직이는 PDF(자바스크립트·외부 실행·첨부 파일·멀티미디어·XFA)는 서명에 걸리지 않아도 거절한다.
> 끝까지 검사하지 못한 파일(크기 한도·연결 끊김)은 통과시키지 않는다.

### §07 KRDS 와이어프레임

첨부 교체만. 본문 결제 문구는 2026-09-27 에 이미 D-42 로 고쳤다.

「화면 원칙」 에 더한다 (D-80):

> 법정 고지는 대학 설정(`notices`, 2인 승인)에서 온다 — 모든 화면 바닥글에 개인정보 처리방침(굵게)·처리 위탁·보호책임자·문의처,
> 검토·결제 화면과 접수증에 전형료 반환 사유·금액·방법. 값이 없으면 그리지 않는다(지어낸 연락처·문안 없음). 원서 양식은 자기소개서를 받지 않는다(설정 검사가 경고).

### §08 부하·장애·복구 테스트

「시나리오」 목록 끝에 더한다:

> 13. 대학 간 장애 격리 — 한 대학 Data Plane 전면 정지 중 다른 대학 접수·중앙 반영, 복구 후 접수 (T-M4-42)

「Acceptance」 에 더한다:

> - API Node 강제 종료(시나리오 10): 계획 정비(drain)는 무중단. 예고 없는 노드 장애는 노드 장애 판정 전 구간을 Edge 재시도로 흡수해 사용자 체감 실패 0 (D-52)

「로컬 축소 환경 결과」 절을 새로 둔다 — 아래 표. **K-PaaS 실측이 아니다.**

| 시나리오 | 결과 (로컬 kind 축소 환경) | 결과 파일 |
|---|---|---|
| 4. 동일 원서 Finalize 100회 동시 | Submission·Outbox·감사 각 1건 | `finalize-concurrency-2026-09-27T16-48-26-726Z.json` |
| 6. Central Sync 2시간 차단 | **실제 120분.** 원서 24건(접수 18·취소 6) 모두 처리, API Ready·자율 운영 모드 유지, DEAD 0, 복구 10초 뒤 24건 전량 전송·중앙 수신 24/24(event loss 0), Pod 재시작 0 | `central-outage-realtime-2026-09-30T01-59-27-784Z.json` |
| 8. Redis 장애 | 접수 흐름 무영향(현재 Redis 미사용) | `redis-outage-kind-2026-09-29T17-16-19-213Z.json` |
| 9. Object Storage 단절 | 카탈로그·작성·저장 지속, 직접 업로드만 실패, 복구 후 정상 | `object-storage-outage-2026-09-28T06-14-19-725Z.json` |
| 5. PG callback 1~30분 지연 | **실제 시간.** 1·5·15·30분 지연 8건 모두 자동 접수 — 콜백 경로 PG 확정 뒤 4.7~7.9초, 콜백 없는 폴링 경로 49.9~171.3초. 이중 확정·중복 접수 0 | `pg-delay-realtime-2026-09-30T06-43-39-291Z.json` |
| 10. API Node 강제 종료 | 제어 1 + 워커 2(zone 2개), 노드 판정 grace 16초, 부하는 클러스터 안. drain 0/666, 정비 뒤 재분산 0/1,139. 강제 정지는 첫 시도 6.1%·재시도 3회 뒤 체감 1.4% — 실패는 거의 다 NotReady(22초) 전 죽은 Pod 로 간 연결 시간 초과(Edge 재시도 대상). 대체 Pod 10초 뒤 살아 있는 zone 에 Ready | `node-failure-kind-2026-09-30T15-46-21-045Z.json` |
| 11. 학교 NAT + 봇 | 정상 사용자 429 = 0, 봇 78~85% 거절, 재시작 0 | `nat-bot-kind-2026-09-29T17-13-42-873Z.json` |
| 13. 대학 간 장애 격리 | A 전면 정지 중 B 접수·중앙 반영, A 복구 후 접수 | `isolation-2026-09-27T16-42-39-057Z.json` |
