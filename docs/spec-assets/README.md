# 설계서 Canonical 첨부파일 배치표

노션 기술설계서 v1.1의 각 절에는 **실제 구현 기준이 되는 첨부파일**이 붙어 있다.
이 파일들이 canonical이며, 저장소에서 같은 내용을 새로 작성하면 원본이 둘로 갈라진다.
아래 경로에 그대로 내려받아 배치한 뒤 커밋한다.

| 노션 문서 | 첨부파일 | 저장소 배치 경로 | 상태 |
|---|---|---|---|
| 02. PostgreSQL ERD | `k-admission-postgresql-ddl.txt` | `infra/db/migrations/0001_init.sql` | ✅ **v1.2 교체 (2026-09-27)** — 저장소 → 노션 업로드 (15,880바이트/397줄) |
| 03. OpenAPI 계약 | `k-admission-openapi.yaml` | `packages/contracts/openapi/k-admission.v1.yaml` | ⚠️ **저장소가 앞섬 (2026-09-30)** — v1.4.0(429 D-51, 흐름 연결 D-55~D-61) 90,088B. 노션 교체 승인 대기 → [06-notion-changeset](../06-notion-changeset.md) |
| 04. CloudEvents | `k-admission-cloudevents-schemas.json` | `packages/contracts/events/k-admission-cloudevents.schema.json` | ⚠️ **저장소가 앞섬 (2026-09-30)** — keyId ≤16(D-47) 5,787B. 노션 교체 승인 대기 |
| 05. Helm 배포 | `k-admission-values-m.yaml` | `deploy/charts/k-admission/values-m.yaml` | ⚠️ **저장소가 앞섬 (2026-09-30)** — v1.2(D-44·D-49·D-52) 3,813B. 노션 교체 승인 대기 |
| 05. Helm 배포 | `k-admission-runtime.yaml` | `deploy/platform/policies/runtime.yaml` | ⚠️ **저장소가 앞섬 (2026-09-30)** — v1.2 = 차트 렌더링 결과 33,814B. 노션 교체 승인 대기 |
| 06. 보안정책 | `k-admission-network-rbac.yaml` | `deploy/platform/policies/network-rbac.yaml` | ✅ 배치 (2026-09-27, SHA-256 원본 일치) 4,099B |
| 06. 보안정책 | `k-admission-vault-policy.hcl.txt` | `deploy/platform/policies/vault-policy.hcl` | ✅ 배치 (2026-09-27, SHA-256 원본 일치) 1,177B |
| 07. KRDS 와이어프레임 | `k-admission-krds-wireframe.html` | `docs/spec-assets/krds-wireframe.html` | ⚠️ **저장소가 앞섬 (2026-09-30)** — v1.2(결제 = 접수, D-43) 8,548B. 노션 교체 승인 대기 |
| 08. 부하테스트 | `k-admission-k6.js.txt` | `tests/load/k6-admission.js` | ✅ 배치 (2026-09-27, SHA-256 원본 일치) 4,358B |
| 09. STRIDE | `k-admission-stride-register.csv` | `docs/spec-assets/stride-register.csv` | ✅ 배치 (2026-09-27, SHA-256 원본 일치) 3,715B |

> ⚠️ **2026-09-30 부터 5종은 저장소가 노션보다 앞선다(R5 의 일시 예외).** 노션 페이지 쓰기가 권한 분류기에 막혀 교체하지 못했다.
> 노션에 올리면 이 표를 ✅ 로 되돌린다. 올릴 파일·바이트·SHA-256 은 [06-notion-changeset.md](../06-notion-changeset.md).

> Notion MCP `download-attachment` 로는 받을 수 없다 (`object_not_found` — 이 연동이 만든
> 업로드가 아니기 때문). 로그인된 브라우저에서 내부 API로 서명 URL을 받아 배치한다.
> 절차는 `docs/02-spec-discrepancy-register.md` D-5 참조.
>
> **배치 후 반드시 문자수·줄수·체크섬을 원본과 대조한다.** 조각내어 옮기므로 누락이 생길 수 있다.

## 배치 후 확인

`apps/admission-api/src/contract-conformance.test.ts` 가 자동으로 대조한다.
DDL·OpenAPI·CloudEvents의 enum과 제약이 `packages/contracts` 상수와 어긋나면 테스트가 깨진다.
`scripts/check-contracts.mjs` 는 계약 파일 자체를 본다 — OpenAPI `$ref`·operationId·대장 번호, 직전 커밋 대비 비호환 변경(§A16),
CloudEvents 스키마 컴파일과 코드의 이벤트 타입 대조. CI contracts 잡이 돌린다.

```bash
npm run test -w @wonseoro/admission-api
npm run check:contracts
```

**첨부를 새 버전으로 교체했는데 이 테스트가 깨지면, 코드를 고치기 전에 먼저 불일치 대장에 등록한다.**
