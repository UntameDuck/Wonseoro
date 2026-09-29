# Flux Pull GitOps

T-M4-05의 실행 주체는 Flux다. Flux는 **각 대학 클러스터 안에서** Git을 Pull하며 중앙 Plane은
대학 kubeconfig나 배포 토큰을 가지지 않는다.

## 구조

```text
bootstrap/<UNIV>.yaml       # 서명 검증 GitRepository + 대학별 Kustomization
base/reconciler-rbac.yaml   # kadmission-app 안에서만 동작하는 release-controller
clusters/<univ>/            # 동일 차트 + Size Profile + 대학 values HelmRelease
local/                      # kind 검증 전용. 운영에 적용 금지
```

운영 Source는 `main`의 HEAD 서명을 `wonseoro-git-authors` Secret의 공개키로 검증한다. SSH 공개키는
`.sshpub`, PGP 공개키는 `.asc` 확장 키로 넣는다. Secret 자체와 개인키는 Git에 저장하지 않는다.

```powershell
kubectl --context <대학-context> apply -f deploy/gitops/bootstrap/namespace.yaml
kubectl --context <대학-context> -n kadmission-app create secret generic wonseoro-git-authors `
  --from-file=release-manager.sshpub=<승인된 SSH 공개키>
kubectl --context <대학-context> apply -f deploy/gitops/base/reconciler-rbac.yaml
kubectl --context <대학-context> apply -f deploy/gitops/bootstrap/UNIV-A.yaml
```

`GitRepository`가 `SourceVerifiedCondition=True`, `Kustomization`과 `HelmRelease`가 `Ready=True`가 되어야
배포 완료다. 현재 운영 values의 이미지 digest와 실 서류 검사 엔진은 의도적으로 비어 있으므로 실제
Registry release가 발행되기 전에는 Helm 렌더링이 fail-closed 한다.

```powershell
kubectl --context <대학-context> -n kadmission-app get gitrepository,kustomization,helmrelease
kubectl --context <대학-context> -n kadmission-app describe gitrepository wonseoro
```

## 신뢰 경계

- Git HEAD: Flux가 SSH/PGP 서명을 검증한다.
- 이미지: production values는 digest를 강제한다. Cosign admission 검증은 T-M5 공급망 게이트다.
- 권한: `release-controller`는 `kadmission-app` 네임스페이스 리소스만 관리한다.
- 비밀: runtime Secret·Git 인증·서명 개인키는 저장소에 넣지 않는다.

로컬 서명 Pull 시험 절차와 축소 환경 차이는 [local/README.md](local/README.md)에 있다.
