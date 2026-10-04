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
| T-M5-26 Security Test | ✅ | 로컬·원격 실 PostgreSQL 선별 시험 123개 통과·건너뜀 0 — 2026-10-03 인증 묶음을 더해 175개, 상호 TLS 묶음을 더해 194개 + 실제 TLS 실증(`test:security:mtls`) |
| T-M5-27 DAST | ✅ | 로컬·원격 ZAP OpenAPI active scan WARN 0·High 0·PASS 118 · 2026-10-03 부터 **토큰을 붙여** 인증 뒤까지(지원자·담당자 요청 4,272건) |
| T-M5-28 Image Signing | ✅ | GHCR 운영 이미지 5종 digest 키리스 서명·신원 검증 |
| T-M5-29 Admission Controller | ✅ | 임시 kind·Policy Controller 0.13.1 webhook 이 서명 digest 허용·미서명 digest 거부 |

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

D-83 로컬 Object Storage 교체 때 고정한 `rustfs/rustfs:1.0.1@sha256:1803faef57627e2d9c2e7d89d655d712ddded5389040054987163043fecb6a3c`도 Trivy 0.75.0 `vuln` 스캐너(`HIGH,CRITICAL`, 수정판 없는 항목 제외)로 별도 확인했고 High/Critical 0이었다(2026-10-04). 이 이미지는 로컬 개발용이며 운영 서비스 이미지 matrix에는 넣지 않는다.

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
`scripts/run-security-tests.mjs`가 다음 다섯 묶음을 직렬 실행하며 TAP의 시험·통과·건너뜀 수를 직접 검사한다.

| 묶음 | 확인 내용 | 로컬 결과 |
|---|---|---:|
| 공용 서버 | 운영 기본값 금지, 목적별 가명화, 개인정보·비밀 로그 마스킹, 운영 발급자 주소(https·로컬 아님) | 31/31 |
| 대학 Data Plane | 소유권 누락, 남의 자원 차단, Adaptive Throttling, 감사 체인, 2인 승인, 파일 형식, PG 콜백 서명·멱등성 | 63/63 |
| 인증·수직 권한 (2026-10-03, T-M5-02·10) | 토큰 위조·알고리즘 혼동·kid 폭주·발급자 장애, 경로 분류·운영 권한을 계약과 대조, 역할 6종 × 범위 표, 재인증, HTTP 수준 BOLA·렐름 섞임·2인 승인 신원 | 40/40 |
| 서비스 간 상호 TLS·출구 (2026-10-03, T-M5-05·07·09) | 워크로드 신원(SAN URI)·다른 CA·신원 없음 거절·인증서 교체, 계약의 mutualTLS 경로 = 코드의 경로 표(대학·중앙), 같은 대학 서류 워커만, 이벤트 출처 해석, 출구 허용 목록(호스트·스킴·메타데이터·DNS 재바인딩) | 17/17 |
| 문서 서비스 | ClamAV 프로토콜, 악성 판정, 해시 불일치·엔진 장애 때 실패 폐쇄, 서명 URL SSRF | 9/9 |
| 중앙 Plane | 이벤트 중복·순서 역전·위장 발신, 중앙 개인정보 최소화, 동의 범위, 지원자 토큰(다른 렐름·대상·위조 거절, 토큰 주체로만 공통원서) | 31/31 |

로컬은 E 드라이브 Docker 데이터의 개발 PostgreSQL 두 DB를 사용해 **총 123개·건너뜀 0**을 확인했다. 인증 묶음을 더한 뒤(2026-10-03) CI 재현 DB(:5499)에서 **175개·건너뜀 0**(중앙 인증 6개·위험 차단 본인확인 해제 2개 포함). 상호 TLS 묶음(D-69, 2026-10-03)을 더해 **194개**, 출구 허용 목록을 더해 **200개·건너뜀 0**. 같은 잡이 실제 TLS 실증(`npm run test:security:mtls` — 개발 PKI·중앙·대학 API·Relay, 25개)도 돈다.
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

### 토큰을 붙인 DAST (2026-10-03, T-M5-02 단계 9)

위 결과는 **신원 없이** 검사한 것이었다. 대학 API 의 지원자·운영 경로는 대부분 신원 확인에서 401·400 으로 멈춰, 그 뒤의 입력 처리·소유권 검사·업무 규칙은
공격 요청을 받지 않았다. 이제 DAST 잡이 대학 API 를 `AUTH_MODE=oidc` 로 띄우고 토큰을 붙인다.

- 시험 발급자 `scripts/security/dast-issuer.mjs` — 렐름 두 개의 discovery·JWKS 와 토큰 둘(지원자 `dast-applicant`, 담당자 `dast-admin` — 역할 admission-admin·security-auditor, acr=mfa).
  토큰 모양은 실제 Keycloak 토큰과 같다(같은지는 `test:auth:api` 가 실제 Keycloak 으로 본다). 비밀 키는 메모리에만, 토큰은 보고서 산출물에 섞지 않는다
- ZAP 시작 훅 `scripts/security/zap-auth-hook.py` — `/api/v1/**` 에 지원자 토큰, `/admin/v1/**` 에 담당자 토큰(Replacer API). `-z "-config replacer…"` 로 넘기면
  ZAP 이 값을 공백에서 잘라 `Bearer` 만 남는다 — 로컬 첫 실행에서 모든 요청이 형식 오류로 거절됐다
- **인증 도달 게이트** `scripts/security/check-dast-auth.mjs` — 대학 API 의 토큰 판정 지표에서 지원자·담당자 토큰이 각각 20건 이상 받아들여졌는지 본다.
  토큰을 못 붙여도 보고서는 High 0 으로 "통과" 하기 때문이다
- 요청 한도는 끈다(`THROTTLE_MODE=off`) — 한 토큰으로 공격 요청을 쏟아붓는다. 한도는 보안 시험·NAT 시험이 따로 본다

로컬 결과(축소 환경, `node scripts/security/dast-local.mjs`): **WARN 0·High 0·PASS 118**, 인증 뒤까지 닿은 요청 지원자 1,236·담당자 3,036(거절 0), 대학 API 오류 로그 0.
원격 Security(run 37108004422)도 같은 수치로 통과했다.
알림은 Informational 3종(공격 요청에 대한 4xx 210건·캐시 정책 설명 2종)뿐이다. 보고서 `E:\DockerData	ools\zap-2.17.0
eports-auth\`.

## 6. T-M5-28 이미지 서명

`release.published`와 명시적인 수동 실행에서 admission-api·event-relay·document-service·central-api·PgBouncer
5개 이미지를 GHCR에 발행한다. 태그를 배포 신뢰 기준으로 쓰지 않고 registry가 돌려준 digest 참조를 Cosign 3.0.6으로
서명한다. 장기 개인키를 저장하지 않고 GitHub Actions OIDC의 단기 신원으로 서명하며, 같은 잡에서 발급자
`https://token.actions.githubusercontent.com`와 정확한 `security.yml@<git ref>` 신원을 다시 검증한다.
이미지별 reference와 검증 JSON은 90일 산출물로 남는다. Sigstore Policy Controller의 일반 이미지 서명 검증과
호환되도록 legacy OCI 서명 형식을 명시했다. 워크플로 불변조건 검사는 5종 누락, tag 서명, 느슨한 신원,
이동 가능한 Action 참조가 생기면 실패한다.

수동 Security run `36903506905`에서 전체 보안 게이트 뒤 실제 발행·서명·검증이 모두 통과했다.

| 이미지 | 검증된 digest |
|---|---|
| admission-api | `sha256:f805239520699f2fcdd2462b350ee2aa7b94d340acd93b49ccce04b605bcdb92` |
| event-relay | `sha256:648eac918201786c2ccf3f467c54695e994d76a197dad1c1cd47d65d7f2e9436` |
| document-service | `sha256:7f92080af222668e5e5aa794f2c68a89e992ecfa6e2ac26577ac7fefc2538826` |
| central-api | `sha256:74b5b988911fc12ef12dd564107c1abbad23915d31d8fa633119ecacb26e746e` |
| pgbouncer | `sha256:622859c86231a75163bdd3ea78faa8ea1d9753a80068eae7de07d2c8b4d2e829` |

로컬 사본은 `E:\DockerData\tools\cosign-3.0.6\run-36903506905`에 있다.

## 7. T-M5-29 Admission Controller

`deploy/platform/policies/image-signature-policy.yaml`은 Sigstore Policy Controller의 강제 모드로 GHCR의
원서로 이미지를 검증한다. 단순히 “유효한 Sigstore 서명”이면 되는 것이 아니라, GitHub OIDC 발급자가 발급했고
이 저장소의 `security.yml`이 **릴리스 태그**에서 만든 서명만 허용한다. 수동 main 검증 서명은 운영 정책에서
의도적으로 거부된다. 적용할 namespace는 `policy.sigstore.dev/include=true` 라벨로 명시적으로 opt-in 한다.

Security 수동/릴리스 실행의 후속 잡은 kind 0.33.0·Kubernetes 1.34.11과 공식 Policy Controller chart
0.10.8(app 0.13.1)을 임시로 설치한다. 현재 실행 신원을 정확히 허용하는 실증용 정책 아래에서 같은 실행이 서명한
admission-api digest는 server dry-run admission을 통과해야 하고, 별도 scratch digest는 서명하지 않은 채 반드시
거부되어야 한다. private GHCR 자격증명은 테스트 namespace의 일회성 `imagePullSecret`에만 넣는다.
수동 Security run `36906282615`에서 통과했다(같은 커밋 CI run `36906280555` 도 통과).

| 실증 | 결과 |
|---|---|
| 미서명 `wonseoro-admission-proof@sha256:820a427b…` | 첫 확인에서 거부 — `admission webhook "policy.sigstore.dev" denied the request: … failed policy: wonseoro-signature-proof … no signatures found` |
| 같은 실행이 서명한 `wonseoro-admission-api@sha256:c55dfb62…` | server dry-run admission 통과 |

첫 원격 실행(run `36905254247`)은 "미서명 통과"로 실패했다. 정책 결함이 아니라 kubectl 에 dry-run 값을 띄어 써서
client dry-run 으로 읽혀 webhook 이 아예 불리지 않은 것이다. 등호로 붙인 server dry-run 으로 고치고, 미서명 거부를
먼저 확인한 뒤(정책이 살아 있을 때) 서명 허용을 보며, 거부 응답이 `policy.sigstore.dev` webhook 에서 왔는지 확인한다.
`check:security:admission` 이 띄어 쓴 dry-run 과 이 순서를 막는다. 증적 사본은
`E:\DockerData\tools\policy-controller-0.13.1\run-36906282615`에 있다.

운영 정책(릴리스 태그 신원만 허용)의 실제 클러스터 적용은 K-PaaS 환경과 함께 한다 — 이 실증은 같은 Policy Controller·같은
정책 형식에서 거부 경로가 실제로 동작함을 보인 것이다.

## 8. 다음 순서

보안 파이프라인 T-M5-20~29 는 모두 끝났다(2026-10-02). 다음은 로컬 OIDC 인증·RBAC·MFA(T-M5-02·10, T-M3-06).
