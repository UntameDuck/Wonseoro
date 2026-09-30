# 노션 반영 변경안 — 승인 대기 (2026-09-30)

> 저장소는 이미 바뀌었고, **노션만 남았다.** 2026-09-30 에 AI 가 노션 페이지를 고치려 했으나 권한 분류기가
> 외부 시스템 쓰기로 막았다. 노션 수정은 사용자가 직접 하거나, AI 에게 노션 쓰기를 허용한 뒤 이 문서대로 적용한다(R6).
> 적용한 조각은 [불일치 대장](02-spec-discrepancy-register.md) 해당 항목의 "노션 반영" 을 `✅ (날짜)` 로 바꾼다.

## 첨부 교체 — 저장소 파일을 **그대로** 올린다 (R5)

올린 뒤 노션에서 내려받은 파일의 바이트 수·SHA-256 이 아래와 같아야 한다.

| 노션 문서 | 첨부 이름 | 저장소 파일 | 바이트 | SHA-256 | 근거 |
|---|---|---|---|---|---|
| [§03 OpenAPI](https://app.notion.com/p/3df75ab5debe81588b56fcd81e7b3856) | `k-admission-openapi.yaml` | `packages/contracts/openapi/k-admission.v1.yaml` (v1.4.0) | 90,088 | `ca2b9fa0151cbf35143776d6ba40767e865c4ffe5780c6f72eef087023049a48` | D-51 · D-55 ~ D-61 |
| [§04 CloudEvents](https://app.notion.com/p/3df75ab5debe81d68e37fabd3678dcc4) | `k-admission-cloudevents-schemas.json` | `packages/contracts/events/k-admission-cloudevents.schema.json` | 5,787 | `56719bada4a9439b5908df690508876b616bf5bfc53b7765fbee23b173b6f5db` | D-47 |
| [§05 Helm](https://app.notion.com/p/3df75ab5debe811cac32ec1c98d50d59) | `k-admission-values-m.yaml` | `deploy/charts/k-admission/values-m.yaml` (v1.2) | 3,813 | `a6c7bb1bacdb223e82a16ad806a36973a7486ddc146c2cfcc56d1b1edb73dfb5` | D-44 · D-49 · D-52 |
| [§05 Helm](https://app.notion.com/p/3df75ab5debe811cac32ec1c98d50d59) | `k-admission-runtime.yaml` | `deploy/platform/policies/runtime.yaml` (v1.2, 차트 렌더링) | 33,814 | `9b11f4c90e4faf6e80e85625b02bd7c22bf890f83c0fd6924256949746b35eb3` | D-44 |
| [§07 KRDS](https://app.notion.com/p/3df75ab5debe812db3d1e06d0761e38e) | `k-admission-krds-wireframe.html` | `docs/spec-assets/krds-wireframe.html` (v1.2) | 8,548 | `698d3abda827340f3abd40fceeb8b7ae63d7e2a6ea8d0e707d3cf4308562995e` | D-43 |

파일을 다시 고치면 이 표의 바이트·해시도 다시 적는다:
`for f in <파일들>; do wc -c <$f; sha256sum $f; done`

## 본문 수정

### 기술설계서 v1.0 본문

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

- **A5** 「기능」의 Config Linter 에 붙인다: "초안을 만들 때 런타임과 같은 엔진으로 양식 JSON Schema 를 컴파일하고 서류 목록 형식을 본다 — 적용하면 실패할 설정은 초안조차 만들지 않고, 모르는 전형 코드·이름 없는 항목은 승인 화면(Diff)에 경고한다 (D-56)"
- **A9** 「해결」 아래에 더한다 (D-61):

  > 구현 — 두 독립 시각원(노드의 NTP 동기 시계·DB 서버 시계)을 10초마다 대조한다(왕복이 가장 짧은 표본, 불확실성 = 왕복/2). 접수 커밋 시각은 트랜잭션 안에서 DB 에 묻고,
  > DB 밖에서 쓰는 시각(요청 수신·화면 표시·감사)은 측정 offset 으로 DB 시계에 맞춘다. 불확실성을 빼고도 1초를 넘은 노드는 **Finalize 만** 503 으로 거절한다 —
  > 트래픽 전체에서 빼면 작성·저장까지 줄어든다. 접수 기록·감사에 offset·불확실성·상태를 남긴다. DB 서버 자체의 시각 동기 감시는 인프라 요구다.
- **B4** 끝에 붙인다: "결제창은 원서마다 하나만 열린다 — 다시 누르면 같은 결제창, 확인 중·확정 결제가 있으면 새 결제를 거절한다. 결제창만 열린 채 콜백이 유실된 승인 결제는 PG 정산 목록 대조가 찾아 접수까지 잇는다 (D-55)"

### §03 OpenAPI 계약

「첨부」 절 끝에 한 줄 더한다:

> **2026-09-30 v1.3.0** — 지원자 오퍼레이션 공통 `429`(`RateLimited`: Problem `code: RATE_LIMITED` + `Retry-After` 초)를 더했다.
> 한도는 IP 가 아니라 인증된 지원자·요청 종류 단위다(ADR-0007). optional 응답 추가라 호환 변경이다(§A16). (D-51)

> **2026-09-30 v1.4.0** — 구현에 있었지만 계약이 설명하지 않던 것을 적었다(D-55 ~ D-61). 결제 의도 `200`(열린 결제창 재사용)·`409 PAYMENT_IN_PROGRESS`,
> 원서 상태 전이 설명, FormSchema `profileFields`·`documents`, Self-check `payment.paymentId`, 현재 모집 `universityName`, 접수증 발급 감사,
> 검사 대기 `downloadUrl`·검사 결과 `signature`, `/healthz/dependencies` 의 `clock`, ConfigDiff `warnings`, 현재 설정 본문, 중앙 공통원서 `GET·PUT /api/v1/profile`,
> 이벤트 수신 규칙(`(source,id)` 중복 제거·미등록 대학 400·심장박동), "내 원서" 대학별 `universityReachable`. 전부 optional 필드·새 경로라 호환 변경이다(§A16).

### §04 CloudEvents Schema

- `subjectRef` 절의 패턴 `^[A-Za-z0-9_-]{1,64}[.][A-Za-z0-9_-]{43}$` → `^[A-Za-z0-9_-]{1,16}[.][A-Za-z0-9_-]{43}$`,
  뒤에 "— keyId 16자 이내(D-47). 전체 60자 이하라 중앙 `subject_ref varchar(64)` 에 들어간다" 를 붙인다
- 「첨부」 절에 "**2026-09-30** — keyId 상한을 16자로 좁힌 판으로 교체(D-47). 생성기와 중앙 DB 가 이미 16자라 기존 이벤트는 그대로 통과한다" 를 더한다
- 「이벤트 타입」 절에 더한다 (D-60 — 스키마 첨부는 그대로):

  > 대학이 보내는 것 — `application.finalized`·`application.cancelled`(Outbox, 원서 원장), `sync.heartbeat`(event-relay 가 기본 60초마다, Outbox 를 거치지 않는다 —
  > 중앙이 끊기면 건너뛴다). 중앙은 심장박동을 수신 원장·sequence gap 에 넣지 않고 대학의 "지금" 상태(적체·설정 버전·시계 offset·마지막 심장박동)를 덮어쓴다.
  > 심장박동이 180초 끊긴 대학은 "내 원서" 에서 확인 불가로 표시한다 — 접수 실패가 아니다.
  > **`payment.confirmed` 는 보내지 않는다** — 결제 확정이 곧 접수(D-42)라 접수 이벤트가 같은 사실을 전하고, 결제 금액·수단은 중앙이 알 필요가 없다(§A3 최소 정보).
  > `configversion`·`policyversion` 확장 속성은 접수 기록의 값이다(접수 전 취소에는 없다).

### §05 Kubernetes·Helm·GitOps

「Runtime 기준」 아래에 절을 더한다:

> **노드 장애 흡수 (D-52, ADR-0008)**
> - zone 분산은 `DoNotSchedule` + **`nodeTaintsPolicy: Honor`** — 장애로 taint 된 노드를 분산 계산에서 빼야 zone 이 2개일 때도 대체 Pod 가 살아 있는 zone 에 놓인다. 가능하면 zone 3개
> - 노드 장애 판정 시간(`node-monitor-grace-period`)은 기본(약 50초) 대신 대학 SLO 에 맞춘다. 판정 전 구간은 Service 가 죽은 Pod 로 요청을 보낸다
> - Edge(Gateway) 는 연결 실패·연결 시간 초과를 다른 엔드포인트로 1회 재시도한다. 모든 변경 요청에 Idempotency-Key 가 있어 POST/PATCH 도 안전하다
> - Edge 구현은 Gateway API 를 지원하는 유지보수 중인 컨트롤러로 한다 — ingress-nginx 는 2026년 3월 상위 프로젝트가 은퇴했다(D-53)

「첨부」 절을 바꾼다:

> `k-admission-values-m.yaml` — M Profile values (v1.2). `k-admission-runtime.yaml` — 차트 + values-m 의 **렌더링 결과**(v1.2).
> 손으로 쓰지 않는다: 차트나 values-m 을 고치고 `scripts/render-runtime-attachment.mjs` 로 다시 만든다(CI 가 드리프트를 막는다).
> v1.2 에서 바뀐 것 — NODE_ENV·포트 3001·프로브 `/healthz`·`/readyz`, 대조는 앱 안 스케줄러, 마감·설정 버전을 배포값에서 제거(2인 승인 우회 차단),
> Pod 당 커넥션 38(최대 391 ≤ 예산 400), Peak Mode 예약 시각은 비우고 `peak-schedule.yaml` 에서 온다(D-49), `nodeTaintsPolicy: Honor`.

「서류 검사 워커」 설명에 더한다 (D-58 — values-m·runtime 첨부는 그대로. 엔진은 대학 values 에서 켠다):

> 실 검사 엔진은 ClamAV 다(`documentService.scannerEngine: clamav`, `clamav.host`). 워커는 Object Storage 자격증명을 갖지 않고, 접수 API 가 검사 대기 목록에 싣는
> 파일 하나·몇 분짜리 서명 URL 로 읽어 clamd 로 흘려보낸다. clamav 일 때만 워커 출구(`scannerEgress` — clamd·Object Storage)가 열린다. clamd 배치(사이드카·공용 서비스)는 K-PaaS 착수 때 정한다.

### §06 NetworkPolicy·RBAC·Vault

「Edge」 또는 NetworkPolicy 설명에 한 줄 더한다 (첨부 `network-rbac.yaml` 은 K-PaaS Edge 확정 뒤 교체):

> 공개 트래픽 입구 선택자(edge 네임스페이스의 `ingress-nginx`)는 예시다. ingress-nginx 는 2026년 3월 은퇴해 보안 패치가 없으므로
> 운영은 Gateway API 를 지원하는 유지보수 중인 컨트롤러로 하고 선택자를 그에 맞춘다(D-53, ADR-0008).

### §07 KRDS 와이어프레임

첨부 교체만. 본문 결제 문구는 2026-09-27 에 이미 D-42 로 고쳤다.

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
| 10. API Node 강제 종료 | drain 무중단(879건 실패 0). 강제 정지는 NotReady 판정(49초)까지 약 10% 끊김 → ADR-0008 | `node-failure-kind-2026-09-29T18-26-14-638Z.json` |
| 11. 학교 NAT + 봇 | 정상 사용자 429 = 0, 봇 78~85% 거절, 재시작 0 | `nat-bot-kind-2026-09-29T17-13-42-873Z.json` |
| 13. 대학 간 장애 격리 | A 전면 정지 중 B 접수·중앙 반영, A 복구 후 접수 | `isolation-2026-09-27T16-42-39-057Z.json` |

시나리오 5(PG 지연)·10 재측정 결과는 시험이 끝나면 이 표에 더한다.
