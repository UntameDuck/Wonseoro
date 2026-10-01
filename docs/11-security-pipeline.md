# 보안 파이프라인 실행 기록

> 기준일: 2026-10-02 · 마일스톤: [M5 신뢰성·보안·접근성](milestones/M5-reliability-security.md)

## 1. 현재 상태

| 게이트 | 상태 | 검사 기준·결과 |
|---|---|---|
| T-M5-20 Secret Scan | ✅ | Gitleaks 8.30.1, Git 전체 이력 실제 비밀 0 |
| T-M5-21 SAST | ✅ | CodeQL `security-extended`, Critical 0. 후속 분석 대상 High 10·Medium 11 |
| T-M5-22 Dependency/SCA | ✅ | 운영 의존성 Critical 0·High 2·Moderate 2 |
| T-M5-23 SBOM | ✅ | SPDX 2.3, 패키지 266·관계 1,054. CI 산출물과 Release 자산 자동 첨부 |
| T-M5-24 Container Image Scan | ✅ | 로컬·원격 5개 이미지 Critical 0 |
| T-M5-25 IaC/K8s Manifest Scan | ✅ | 로컬·원격 Helm·Kubernetes·Dockerfile 19개 High/Critical 0 |
| T-M5-26 Security Test | ✅ | 로컬·원격 실 PostgreSQL 선별 시험 123개 통과·건너뜀 0 |
| T-M5-27 DAST | ✅ | 로컬·원격 ZAP OpenAPI active scan WARN 0·High 0·PASS 118 |
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
원격 matrix도 모두 통과했다(Actions run 36890582638).

## 3. T-M5-25 IaC·Kubernetes 검사

Trivy config가 다음을 함께 검사한다.

- Helm 차트: 운영 M 프로필과 서명 digest·실 검사 엔진 자리표시값으로 렌더링
- Kubernetes: GitOps bootstrap·release·RBAC, 정책 첨부와 렌더링 runtime
- Dockerfile: 공통 서비스 이미지와 PgBouncer 이미지

로컬에서 설정 파일 19개를 검사해 허용되지 않은 High/Critical 정책 위반은 0건이다.
같은 명령을 실행하는 원격 IaC 잡도 통과했다(Actions run 36890582638).

### 제한된 예외

`KSV-0056` 하나를 `.trivyignore.yaml`에서 파일 네 곳에만 허용한다. namespace 한정 `release-controller`가
서명 검증을 통과한 Helm 릴리스의 Service와 NetworkPolicy를 동기화하려면 필요한 권한이다. 클러스터 범위 권한과
Endpoints 직접 권한은 없고 `tests/m4/gitops-manifests.mjs`가 권한 범위 확대를 회귀 검사한다.
예외는 **2027-01-31 만료**이며 그 전에 권한·배포 구조를 다시 검토한다.

## 4. T-M5-26 선별 보안 시험

`npm run test:security`는 전체 회귀시험과 별도로 보안 불변식이 드러나는 시험만 선별한다. 빌드 뒤
`scripts/run-security-tests.mjs`가 다음 네 묶음을 직렬 실행하며 TAP의 시험·통과·건너뜀 수를 직접 검사한다.

| 묶음 | 확인 내용 | 로컬 결과 |
|---|---|---:|
| 공용 서버 | 운영 기본값 금지, 목적별 가명화, 개인정보·비밀 로그 마스킹 | 27/27 |
| 대학 Data Plane | 소유권 누락, 남의 자원 차단, Adaptive Throttling, 감사 체인, 2인 승인, 파일 형식, PG 콜백 서명·멱등성 | 63/63 |
| 문서 서비스 | ClamAV 프로토콜, 악성 판정, 해시 불일치·엔진 장애 때 실패 폐쇄 | 8/8 |
| 중앙 Plane | 이벤트 중복·순서 역전·위장 발신, 중앙 개인정보 최소화, 동의 범위 | 25/25 |

로컬은 E 드라이브 Docker 데이터의 개발 PostgreSQL 두 DB를 사용해 **총 123개·건너뜀 0**을 확인했다.
`.github/workflows/security.yml`의 전용 잡은 빈 PostgreSQL 16 DB에 canonical 대학 DDL과 중앙 마이그레이션을 적용한 뒤
같은 명령을 실행한다. DB가 없어서 통합시험이 `skip`되면 성공으로 보지 않고 게이트를 실패시킨다.
원격 Security 잡도 123개·건너뜀 0으로 통과했다(Actions run 36898652054).

## 5. T-M5-27 OpenAPI DAST

ZAP 2.17.0 이미지(`sha256:781a…81ef`)를 고정해 실제 대학 API와 PostgreSQL을 띄운 뒤 canonical OpenAPI의
81개 URL을 active scan한다. `scripts/check-zap-report.mjs`는 JSON 보고서에 실제 site가 있는지 먼저 확인하고
위험도 High가 하나라도 있으면 실패한다. HTML·JSON 보고서는 원격 CI 산출물로 14일 보관한다.

첫 로컬 실행은 High 0이었지만 다음 Low 경고를 통해 입력 경계 결함을 찾았다.

- UUID인 `cycleId`·`admissionCycleId`와 정수 `limit`의 공격 문자열이 DB까지 내려가 500을 만들었다
- 계약상 쿼리 없이 부를 수 있는 `/api/v1/meta/time`이 내부 문자열 `default`를 UUID로 조회해 500을 냈다
- 일부 API 응답에 `X-Content-Type-Options: nosniff`가 없었다

DB 앞 쿼리 형식 차단, 현재 열린 모집 선택, 전 응답 `nosniff`를 적용한 뒤 같은 조건으로 재실행했다.
최종 결과는 로컬·원격 모두 **WARN 0·High 0·PASS 118**이며 원격 Security와 일반 CI도 통과했다
(Actions run 36902632192·36902632233). 로컬 보고서는
`E:\DockerData\tools\zap-2.17.0\reports\zap-report.{json,html}`에 있다. JSON에는 공격 요청에 대한 4xx와
캐시 정책을 설명하는 Informational 3종만 남았다.

## 6. 다음 순서

1. T-M5-28: 키 없는 OIDC 서명으로 모든 릴리스 이미지 서명·검증
2. T-M5-29: 정책 엔진에서 미서명 이미지는 거부하고 서명 이미지만 허용하는 실증
