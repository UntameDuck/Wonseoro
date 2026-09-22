# 설계서 Canonical 첨부파일 배치표

노션 기술설계서 v1.1의 각 절에는 **실제 구현 기준이 되는 첨부파일**이 붙어 있다.
이 파일들이 canonical이며, 저장소에서 같은 내용을 새로 작성하면 원본이 둘로 갈라진다.
아래 경로에 그대로 내려받아 배치한 뒤 커밋한다.

| 노션 문서 | 첨부파일 | 저장소 배치 경로 | 상태 |
|---|---|---|---|
| 02. PostgreSQL ERD | `k-admission-postgresql-ddl.txt` | `infra/db/migrations/0001_init.sql` | ⬜ 미배치 |
| 03. OpenAPI 계약 | `k-admission-openapi.yaml` | `packages/contracts/openapi/k-admission.v1.yaml` | ⬜ 미배치 |
| 04. CloudEvents | `k-admission-cloudevents-schemas.json` | `packages/contracts/events/k-admission-cloudevents.schema.json` | ⬜ 미배치 |
| 05. Helm 배포 | `k-admission-values-m.yaml` | `deploy/charts/k-admission/values-m.yaml` | ⬜ 미배치 |
| 05. Helm 배포 | `k-admission-runtime.yaml` | `deploy/platform/policies/runtime.yaml` | ⬜ 미배치 |
| 06. 보안정책 | `k-admission-network-rbac.yaml` | `deploy/platform/policies/network-rbac.yaml` | ⬜ 미배치 |
| 06. 보안정책 | `k-admission-vault-policy.hcl.txt` | `deploy/platform/policies/vault-policy.hcl` | ⬜ 미배치 |
| 07. KRDS 와이어프레임 | `k-admission-krds-wireframe.html` | `docs/spec-assets/krds-wireframe.html` | ⬜ 미배치 |
| 08. 부하테스트 | `k-admission-k6.js.txt` | `tests/load/k6-admission.js` | ⬜ 미배치 |
| 09. STRIDE | `k-admission-stride-register.csv` | `docs/spec-assets/stride-register.csv` | ⬜ 미배치 |

> 자동 다운로드는 실패한다. 해당 첨부들은 현재 Notion 연동 통합의 소유가 아니므로
> API로 받을 수 없다 (`object_not_found`). 노션 화면에서 직접 내려받아야 한다.

## 배치 후 확인

- `0001_init.sql` — infra/db/README.md의 정합성 제약 5종이 실제로 들어갔는지
- `k-admission.v1.yaml` — 03 문서의 Applicant/Admin/Internal API 엔드포인트가 전부 있는지
- `k-admission-cloudevents.schema.json` — 이벤트 타입이 `kr.kadmission.*` 네임스페이스인지
