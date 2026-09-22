# deploy — GitOps 배포 저장소 구조

근거: 기술설계서 v1.0 §13.1, v1.1 §05

**배포 원칙**: 동일 Signed OCI Image를 대학별 values로 배포한다. **대학별 code fork 금지.**
중앙에서 대학 Cluster로 Push 배포하지 않는다. 대학 Cluster가 승인된 Git/Registry에서 Signed Artifact를 **Pull**한다.

```
deploy/
├── charts/k-admission/     # Helm 차트 (Chart.yaml, values.yaml, values-s/m/l.yaml, templates/)
├── platform/
│   ├── namespaces/
│   ├── policies/           # NetworkPolicy, RBAC, Vault policy, runtime 보안 기준
│   ├── observability/
│   └── admission-controller/
├── universities/UNIV-A/    # values.yaml, config-ref.yaml, policy-ref.yaml
└── schemas/                # packages/contracts 에서 생성·복사
```

## Release 파이프라인
```
Commit → Build → Test → SBOM → Scan → Sign → Registry → Staging → 2인 승인
       → University GitOps Pull → Canary/Rolling → Health Gate
```

## Runtime 보안 기준 (v1.1 §05)
- `runAsNonRoot`, `readOnlyRootFilesystem`, seccomp `RuntimeDefault`
- `allowPrivilegeEscalation=false`, capabilities `drop: ALL`
- startup / readiness / liveness probe 전부 설정
- topology spread, anti-affinity, PDB
- requests/limits 필수
- HPA는 CPU뿐 아니라 RPS/Latency/Queue 지표 사용

## DB
기본 권장은 **Kubernetes 밖** 또는 별도 HA 데이터 계층의 PostgreSQL이다.
기관이 DB Operator를 인증·운영할 역량이 있는 경우에만 Stateful DB Profile을 허용한다.

## Change Freeze (v1.0 §13.2)
`D-30 Feature Complete` → `D-14 기능 Freeze` → `D-7 성능·DR·보안 최종검증` → `D-1 설정만 변경`
→ 접수기간: SEV1 보안/장애 Fix만 Emergency Change

## Size Profile (v1.0 §10.1)
| Profile | 예상 최종 지원건 | 설계 CCU | Load Test | API Pod 초기값 |
|---|---|---|---|---|
| S | ~10,000 | 500 | 1,000 CCU | 4 vCPU / 8GB × 2 |
| M | ~30,000 | 1,500 | 3,000 CCU | 8 vCPU / 16GB × 3 |
| L | ~60,000 | 3,000 | 6,000 CCU | 8 vCPU / 16GB × 4~6 |
