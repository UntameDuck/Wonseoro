# 설계서 Canonical 첨부파일 배치표

노션 기술설계서 v1.1의 각 절에는 **실제 구현 기준이 되는 첨부파일**이 붙어 있다.
이 파일들이 canonical이며, 저장소에서 같은 내용을 새로 작성하면 원본이 둘로 갈라진다.
아래 경로에 그대로 내려받아 배치한 뒤 커밋한다.

| 노션 문서 | 첨부파일 | 저장소 배치 경로 | 상태 |
|---|---|---|---|
| 02. PostgreSQL ERD | `k-admission-postgresql-ddl.txt` | `infra/db/migrations/0001_init.sql` | ✅ 배치 (10,641자/288줄) |
| 03. OpenAPI 계약 | `k-admission-openapi.yaml` | `packages/contracts/openapi/k-admission.v1.yaml` | ✅ 배치 (24,427자/734줄) |
| 04. CloudEvents | `k-admission-cloudevents-schemas.json` | `packages/contracts/events/k-admission-cloudevents.schema.json` | ✅ 배치 (5,504자/126줄) |
| 05. Helm 배포 | `k-admission-values-m.yaml` | `deploy/charts/k-admission/values-m.yaml` | ⬜ 미배치 |
| 05. Helm 배포 | `k-admission-runtime.yaml` | `deploy/platform/policies/runtime.yaml` | ⬜ 미배치 |
| 06. 보안정책 | `k-admission-network-rbac.yaml` | `deploy/platform/policies/network-rbac.yaml` | ⬜ 미배치 |
| 06. 보안정책 | `k-admission-vault-policy.hcl.txt` | `deploy/platform/policies/vault-policy.hcl` | ⬜ 미배치 |
| 07. KRDS 와이어프레임 | `k-admission-krds-wireframe.html` | `docs/spec-assets/krds-wireframe.html` | ⬜ 미배치 |
| 08. 부하테스트 | `k-admission-k6.js.txt` | `tests/load/k6-admission.js` | ⬜ 미배치 |
| 09. STRIDE | `k-admission-stride-register.csv` | `docs/spec-assets/stride-register.csv` | ⬜ 미배치 |

> Notion MCP `download-attachment` 로는 받을 수 없다 (`object_not_found` — 이 연동이 만든
> 업로드가 아니기 때문). 로그인된 브라우저에서 내부 API로 서명 URL을 받아 배치한다.
> 절차는 `docs/02-spec-discrepancy-register.md` D-5 참조.
>
> **배치 후 반드시 문자수·줄수·체크섬을 원본과 대조한다.** 조각내어 옮기므로 누락이 생길 수 있다.

## 배치 후 확인

`apps/admission-api/src/contract-conformance.test.ts` 가 자동으로 대조한다.
DDL·OpenAPI·CloudEvents의 enum과 제약이 `packages/contracts` 상수와 어긋나면 테스트가 깨진다.

```bash
npm run test -w @wonseoro/admission-api
```

**첨부를 새 버전으로 교체했는데 이 테스트가 깨지면, 코드를 고치기 전에 먼저 불일치 대장에 등록한다.**
