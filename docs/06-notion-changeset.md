# 노션 반영 변경안 — 승인 대기 (2026-09-30)

> 저장소는 이미 바뀌었고, **노션만 남았다.** 2026-09-30 에 AI 가 노션 페이지를 고치려 했으나 권한 분류기가
> 외부 시스템 쓰기로 막았다. 노션 수정은 사용자가 직접 하거나, AI 에게 노션 쓰기를 허용한 뒤 이 문서대로 적용한다(R6).
> 적용한 조각은 [불일치 대장](02-spec-discrepancy-register.md) 해당 항목의 "노션 반영" 을 `✅ (날짜)` 로 바꾼다.

## 첨부 교체 — 저장소 파일을 **그대로** 올린다 (R5)

올린 뒤 노션에서 내려받은 파일의 바이트 수·SHA-256 이 아래와 같아야 한다.

| 노션 문서 | 첨부 이름 | 저장소 파일 | 바이트 | SHA-256 | 근거 |
|---|---|---|---|---|---|
| [§03 OpenAPI](https://app.notion.com/p/3df75ab5debe81588b56fcd81e7b3856) | `k-admission-openapi.yaml` | `packages/contracts/openapi/k-admission.v1.yaml` (v1.3.0) | 78,382 | `cb809ab905679547b429968d8f28df361f6c80bbf77bdec694a87ecaeb8a548d` | D-51 |
| [§04 CloudEvents](https://app.notion.com/p/3df75ab5debe81d68e37fabd3678dcc4) | `k-admission-cloudevents-schemas.json` | `packages/contracts/events/k-admission-cloudevents.schema.json` | 5,787 | `56719bada4a9439b5908df690508876b616bf5bfc53b7765fbee23b173b6f5db` | D-47 |
| [§05 Helm](https://app.notion.com/p/3df75ab5debe811cac32ec1c98d50d59) | `k-admission-values-m.yaml` | `deploy/charts/k-admission/values-m.yaml` (v1.2) | 3,813 | `a6c7bb1bacdb223e82a16ad806a36973a7486ddc146c2cfcc56d1b1edb73dfb5` | D-44 · D-49 · D-52 |
| [§05 Helm](https://app.notion.com/p/3df75ab5debe811cac32ec1c98d50d59) | `k-admission-runtime.yaml` | `deploy/platform/policies/runtime.yaml` (v1.2, 차트 렌더링) | 33,814 | `9b11f4c90e4faf6e80e85625b02bd7c22bf890f83c0fd6924256949746b35eb3` | D-44 |
| [§07 KRDS](https://app.notion.com/p/3df75ab5debe812db3d1e06d0761e38e) | `k-admission-krds-wireframe.html` | `docs/spec-assets/krds-wireframe.html` (v1.2) | 8,548 | `698d3abda827340f3abd40fceeb8b7ae63d7e2a6ea8d0e707d3cf4308562995e` | D-43 |

파일을 다시 고치면 이 표의 바이트·해시도 다시 적는다:
`for f in <파일들>; do wc -c <$f; sha256sum $f; done`

## 본문 수정

### §03 OpenAPI 계약

「첨부」 절 끝에 한 줄 더한다:

> **2026-09-30 v1.3.0** — 지원자 오퍼레이션 공통 `429`(`RateLimited`: Problem `code: RATE_LIMITED` + `Retry-After` 초)를 더했다.
> 한도는 IP 가 아니라 인증된 지원자·요청 종류 단위다(ADR-0007). optional 응답 추가라 호환 변경이다(§A16). (D-51)

### §04 CloudEvents Schema

- `subjectRef` 절의 패턴 `^[A-Za-z0-9_-]{1,64}[.][A-Za-z0-9_-]{43}$` → `^[A-Za-z0-9_-]{1,16}[.][A-Za-z0-9_-]{43}$`,
  뒤에 "— keyId 16자 이내(D-47). 전체 60자 이하라 중앙 `subject_ref varchar(64)` 에 들어간다" 를 붙인다
- 「첨부」 절에 "**2026-09-30** — keyId 상한을 16자로 좁힌 판으로 교체(D-47). 생성기와 중앙 DB 가 이미 16자라 기존 이벤트는 그대로 통과한다" 를 더한다

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

<!-- 결과 표: 시험이 끝나면 채운다 -->
