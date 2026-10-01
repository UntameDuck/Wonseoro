# 보안 파이프라인 실행 기록

> 기준일: 2026-10-02 · 마일스톤: [M5 신뢰성·보안·접근성](milestones/M5-reliability-security.md)

## 1. 현재 상태

| 게이트 | 상태 | 검사 기준·결과 |
|---|---|---|
| T-M5-20 Secret Scan | ✅ | Gitleaks 8.30.1, Git 전체 이력 실제 비밀 0 |
| T-M5-21 SAST | ✅ | CodeQL `security-extended`, Critical 0. 후속 분석 대상 High 10·Medium 11 |
| T-M5-22 Dependency/SCA | ✅ | 운영 의존성 Critical 0·High 2·Moderate 2 |
| T-M5-23 SBOM | ✅ | SPDX 2.3, 패키지 266·관계 1,054. CI 산출물과 Release 자산 자동 첨부 |
| T-M5-24 Container Image Scan | 🟡 | 로컬 5개 이미지 Critical 0, 원격 CI 확인 전 |
| T-M5-25 IaC/K8s Manifest Scan | 🟡 | 로컬 Helm·Kubernetes·Dockerfile 19개 High/Critical 0, 원격 CI 확인 전 |
| T-M5-26 Security Test | ⬜ | 다음 작업 |
| T-M5-27 DAST | ⬜ | 다음 작업 |
| T-M5-28 Image Signing | ⬜ | 다음 작업 |
| T-M5-29 Admission Controller | ⬜ | 다음 작업 |

## 2. T-M5-24 이미지 검사

Trivy 0.75.0으로 운영 런타임 이미지의 OS와 라이브러리를 함께 검사한다. 로컬 도구·DB 캐시는
`E:\DockerData\tools\trivy-0.75.0`·`E:\DockerData\tools\trivy-cache`에 두어 C 드라이브를 쓰지 않는다.

| 이미지 | 빌드 파일 | 로컬 Critical |
|---|---|---:|
| `k-admission/admission-api:security-scan` | `deploy/docker/Dockerfile` | 0 |
| `k-admission/event-relay:security-scan` | `deploy/docker/Dockerfile` | 0 |
| `k-admission/document-service:security-scan` | `deploy/docker/Dockerfile` | 0 |
| `k-admission/central-api:security-scan` | `deploy/docker/Dockerfile` | 0 |
| `k-admission/pgbouncer:security-scan` | `deploy/docker/pgbouncer/Dockerfile` | 0 |

CI는 `.github/workflows/security.yml`의 5개 matrix 잡에서 각 이미지를 실제 빌드하고 Trivy의
`os,library` 스캐너로 Critical이 하나라도 있으면 실패한다. `ignore-unfixed`를 켜지 않아 수정판이 없는 Critical도 숨기지 않는다.

## 3. T-M5-25 IaC·Kubernetes 검사

Trivy config가 다음을 함께 검사한다.

- Helm 차트: 운영 M 프로필과 서명 digest·실 검사 엔진 자리표시값으로 렌더링
- Kubernetes: GitOps bootstrap·release·RBAC, 정책 첨부와 렌더링 runtime
- Dockerfile: 공통 서비스 이미지와 PgBouncer 이미지

로컬에서 설정 파일 19개를 검사해 허용되지 않은 High/Critical 정책 위반은 0건이다.

### 제한된 예외

`KSV-0056` 하나를 `.trivyignore.yaml`에서 파일 네 곳에만 허용한다. namespace 한정 `release-controller`가
서명 검증을 통과한 Helm 릴리스의 Service와 NetworkPolicy를 동기화하려면 필요한 권한이다. 클러스터 범위 권한과
Endpoints 직접 권한은 없고 `tests/m4/gitops-manifests.mjs`가 권한 범위 확대를 회귀 검사한다.
예외는 **2027-01-31 만료**이며 그 전에 권한·배포 구조를 다시 검토한다.

## 4. 다음 순서

1. 원격 CI에서 T-M5-24·25 통과 확인 후 완료 수 반영
2. T-M5-26: 인증·인가·입력·재전송·감사 불변식 보안 시험 묶음을 별도 잡으로 실행
3. T-M5-27: 로컬 staging API를 기동해 DAST High 0 강제
4. T-M5-28: 키 없는 OIDC 서명으로 모든 릴리스 이미지 서명·검증
5. T-M5-29: 정책 엔진에서 미서명 이미지는 거부하고 서명 이미지만 허용하는 실증
