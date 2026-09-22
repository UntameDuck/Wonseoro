# 보안정책 (M5)

근거: 기술설계서 v1.1 §06. canonical 파일은 노션 첨부 — `docs/spec-assets/README.md` 참조.

## Network — Default Deny
모든 namespace를 default deny로 시작한다.

허용 경로만 명시:
`Ingress→Frontend/API` · `Frontend→API` · `API→DB/Redis/Object Storage` ·
`Payment Adapter→PG` · `Event Relay→Central` · `Workload→DNS`

금지: **Frontend→DB 직접접속**, 임의 Internet egress, **대학 간 데이터 네트워크**

## RBAC 역할
| 역할 | 권한 |
|---|---|
| `platform-viewer` | 조회만. Secret 금지 |
| `sre-operator` | scale/restart/log. Secret 원문·RBAC 변경 금지 |
| `admission-admin` | 업무 Config API만. Kubernetes 권한 없음 |
| `security-auditor` | Audit/Security Read-only |
| `release-controller` | 지정 namespace의 승인 Release만 reconcile |
| `break-glass` | 평소 disable, 짧은 TTL, 사용 즉시 경보 |

## Secret
Vault/KMS/HSM 계층에서 **대학별 path 분리**. 가능하면 DB dynamic credential, mTLS 인증서 short TTL.

> 공공기관 암호모듈 요건이 적용되는 경우 Vault 자체 기능을 자동으로 KCMVP 충족으로 간주하지 않는다.
> 검증필 모듈/HSM/KMS와 기관 정책을 별도 적용한다.

## Supply Chain
SBOM · SCA · Secret Scan · Container/IaC Scan · Image Signature · Digest Pinning
