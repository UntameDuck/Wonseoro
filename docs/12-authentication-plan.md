# 인증 착수 준비 — 로컬 OIDC·RBAC 6역할·관리자 MFA·JWKS 캐시

> 기준일: 2026-10-02 · 대상 태스크: **T-M5-02**(RBAC 6역할 + 지원자 본인확인 세션·위험 차단 해제) ·
> **T-M5-10**(관리자 MFA·Step-up) · **T-M3-06** 남은 칸(Local JWKS Cache) · 함께 움직이는 것: T-M5-45 세션 만료(`lib/session.ts`),
> ADR-0009 위험 차단 해제, T-M5-03 break-glass(역할만 — 경보·TTL 은 T-M5-03)
>
> 설계 원본: 노션 [06. NetworkPolicy·RBAC·Vault](https://app.notion.com/p/3df75ab5debe81e0aab2e000ccdebba7) — "Default Deny,
> Least Privilege, Workload Identity, Short-lived Credential, Two-person approval", 역할 6종, App Security 의 "Admin MFA/Step-up".
> 계약: `packages/contracts/openapi/k-admission.v1.yaml` 의 `securitySchemes.oidc`(openIdConnect)·범위 `admin`/`operator`/`auditor`.

## 1. 지금 상태 (2026-10-02 점검)

| 자리 | 지금 | 비고 |
|---|---|---|
| 대학 API 신원 | `AUTH_MODE=dev-headers`(헤더를 그대로 믿음) / `gateway`(앞단이 넣은 `x-authenticated-*` 헤더) — `apps/admission-api/src/common/identity/identity.ts` 한 곳 | 운영에서 dev-headers 는 기동 거부(R8). **gateway 를 넣어 줄 앞단은 차트에 없다** |
| 운영 API 문 | `AdminGuard` 공유 비밀 `ADMIN_API_TOKEN` + 감사용 `x-admin-id` | 역할 구분 없음 — 범위 `admin`/`operator`/`auditor` 가 계약에만 있다 |
| 중앙 API 신원 | `subjectOf()` — dev `x-subject-token` / gateway `x-authenticated-subject` (`apps/central-api/src/identity.ts`) | |
| 콘솔(admin-web) | 개발 서버에서만 담당자 입력칸·쿠키. 운영 빌드는 "관리자 로그인이 구성되지 않아 콘솔을 쓸 수 없습니다" | `apps/admin-web/src/lib/server.ts` |
| 지원자 화면 | 개발 본인확인(`WONSEORO_DEV_IDENTITY`)·시드 지원자 1명. 세션 만료는 브라우저 시계(`lib/session.ts`, 무활동 30분·5분 전 경고) | 운영 빌드에는 입력칸이 없다 |
| 지원자 등록 | **API 경로가 없다** — `kadmission.applicant` 행은 시드·시험만 만든다 | 첫 로그인 때 만드는 길이 필요 |
| 계약 범위 | `admin` 16개 경로 · `operator` 2개(대사 예외 목록·대사 실행) · `auditor` 1개(증적 패키지) · 지원자 경로는 전역 `oidc: []` · 공개 7개 · 내부 `mutualTLS` 6개 | |
| K8s 역할 | 노션 첨부 `network-rbac.yaml`·차트 `templates/rbac.yaml` 에 **platform-viewer·sre-operator·release-controller 3종만** | admission-admin·security-auditor·break-glass 없음 |
| JWKS 캐시 | 없음 — 검증할 토큰이 없어 M3 에서 미뤘다(`M3-operational-safeguards.md` T-M3-06) | |

## 2. 결정 (AI 판단, 2026-10-02)

| # | 결정 | 이유 |
|---|---|---|
| A1 | **로컬 발급자는 Keycloak 26.8.0**(`quay.io/keycloak/keycloak@sha256:b0f60d48…2bcc`), compose 프로필 `auth`, 포트 **18080**, `start-dev --import-realm` | 표준 OIDC(Authorization Code + PKCE)·TOTP MFA·ACR(인증 수준)·역할 클레임을 설정 파일 하나로 재현한다. 직접 만든 가짜 발급자는 MFA·step-up 을 흉내만 낸다. Dex 는 MFA 가 없다 |
| A2 | 렐름 둘: **`wonseoro-staff`**(대학 담당자 — 비밀번호 + TOTP 필수, 역할 6종) · **`wonseoro-applicant`**(지원자 본인확인 흉내 — 실 간편인증·PASS 는 외부 기관, B/C) | 담당자와 지원자의 세션·정책·키를 섞지 않는다 |
| A3 | **API 가 토큰을 직접 검증한다 — `AUTH_MODE=oidc` 추가**(dev-headers·gateway 는 그대로 둔다) | 차트에 gateway 가 없고, T-M3-06 의 "중앙 IAM 이 끊겨도 이미 접속한 사용자는 계속" 은 **대학 쪽 JWKS 캐시**가 있어야 성립한다 |
| A4 | **JWKS 캐시는 `server-kit` 에 직접 둔다**(서명 검증은 `jose` 6.2.12) — 메모리 + 마지막으로 받은 키 묶음 보관, 모르는 `kid` 면 쿨다운을 두고 한 번만 다시 받기, 발급자가 죽어도 **최대 보관 시간까지 기존 키로 검증**, 키 나이 지표 | `jose` 의 원격 키 묶음은 발급자 장애 때 버틴다는 보장이 없다. 인수 시험이 "발급자 차단 중 검증 지속" 이다 |
| A5 | **역할 매핑**: 계약 범위 → 앱 역할 — `admin` → `admission-admin`, `operator` → `admission-admin`(대사는 업무다), `auditor` → `security-auditor`. platform-viewer·sre-operator·release-controller·break-glass 는 **업무 API 권한이 없다**(K8s 전용) | 노션 06: "admission-admin: 업무 Config API만, Kubernetes 권한 없음", "security-auditor: Audit/Security Read-only". 계약 범위 이름과 역할 이름이 달라 **대장 D-N 으로 올린다**(구현 첫 커밋에서 번호) |
| A6 | **MFA·step-up**: staff 렐름은 로그인 때 TOTP 필수(ACR `2`). 운영 API 는 모든 경로에서 `acr ≥ 2` 를 요구. **민감 동작**(증적 패키지 열람, Config·마감 승인/활성화/되돌리기, 대사 예외 해결)은 `auth_time` 5분 이내 + **목적·사유 입력**을 요구하고, 넘으면 다시 인증(`max_age=0`)으로 보낸다 | T-M5-10 인수기준 "민감정보 조회 시 목적·사유 입력", STRIDE E-03 "server-side RBAC/ABAC; step-up; two-person approval" |
| A7 | **콘솔 로그인은 서버 쪽(BFF)** — Next.js 서버가 Authorization Code + PKCE 를 하고 토큰은 서버에만 둔다. 브라우저에는 `HttpOnly`·`Secure`·`SameSite=Lax` 세션 쿠키만 | 노션 06 App Security "Secure/HttpOnly/SameSite Cookie". 콘솔은 이미 서버에서 API 를 부른다(`lib/server.ts`) |
| A8 | **지원자 로그인은 공개 클라이언트 + PKCE** — 액세스 토큰은 메모리, 회전되는 갱신 토큰만 `sessionStorage`. 지원자 세션 무활동 30분은 **발급자 세션 설정(SSO Session Idle 30분)** 으로 옮기고, 5분 전 경고·"연장" 은 토큰 갱신으로 바꾼다 | 지금 화면은 브라우저에서 API 를 직접 부른다(CORS). `lib/session.ts` 한 곳만 바꾸면 된다(T-M5-45 에서 그렇게 모아 뒀다) |
| A9 | **지원자 등록**: 첫 인증 요청에서 토큰 `sub`(렐름별 가명)를 `subject_token` 으로 `applicant` 행을 만든다. 실명·주민번호 등은 받지 않는다(`pii_ciphertext` 는 필드 암호화 T-M5-06·실 본인확인과 함께) | 법정 고지 문서 [10 §6 G-7](10-admission-privacy-and-legal-notices.md) — 주민번호 수집은 본인확인 기관 연동 때 결정 |
| A10 | **위험 차단 해제(ADR-0009)**: 위험점수 차단 응답에 "다시 본인확인" 길을 알리고, 화면은 `max_age=0` 로 재인증한다. API 는 토큰 `auth_time` 이 차단 시각보다 새로우면 그 지원자의 차단을 푼다 | ADR-0009 · T-M5-02 인수기준 |
| A11 | **K8s 역할 6종**: 노션 첨부 `network-rbac.yaml` 은 고치지 않는다(R5). 차트 `templates/rbac.yaml` 에 security-auditor(조회 전용, Secret 없음)·break-glass(Role 만, **바인딩 없음 = 평소 비활성**)를 더하고 admission-admin 은 K8s 권한 0 을 시험으로 고정한다. 첨부와 차트 차이는 대장에 올린다 | 노션 06 역할 정의 그대로 |
| A12 | 운영 안전장치: 운영(`NODE_ENV=production`)에서 `AUTH_MODE=oidc` 의 발급자가 `http:`·`localhost`·로컬 렐름이면 기동 거부. oidc 모드에서는 `ADMIN_API_TOKEN` 을 쓰지 않는다 | R8 과 같은 결 — 개발 발급자가 운영에 섞이지 않게 |

## 3. 작업 순서와 인수 시험

| 단계 | 내용 | 끝났다고 말할 근거 |
|---|---|---|
| 1 | 로컬 발급자 — compose `auth` 프로필, 렐름 파일 2개(`infra/auth/`), 시험 담당자 6역할·지원자 2명·TOTP 시험 비밀(로컬 전용 시드값) | 기동 후 discovery·JWKS·역할 클레임·ACR 확인 스크립트 통과 |
| 2 | `server-kit` OIDC 검증기 + JWKS 캐시 | 단위 시험: 서명·만료·발급자·대상(aud) 위조 거절, 키 회전, 발급자 차단 중 검증 지속, 모르는 kid 폭주 시 다시 받기 1회 |
| 3 | 대학 API `AUTH_MODE=oidc` — 지원자(`sub`→applicant), 운영 API 역할·ACR·step-up 가드, 2인 승인 신원을 토큰 `sub` 로 | **수직 권한 시험**(역할×경로 전 조합, STRIDE E-03), 본인 승인 금지, 기존 소유권 시험(R10)·BOLA 시험 유지 |
| 4 | 중앙 API `AUTH_MODE=oidc` | 대시보드·프로필 금고가 토큰 가명으로만 동작 |
| 5 | 콘솔 로그인(BFF)·MFA·민감 동작 재인증·목적·사유 | 브라우저 시험: 로그인→TOTP→승인, 5분 지난 증적 열람은 재인증, 다른 역할은 메뉴·API 모두 거절 |
| 6 | 지원자 로그인·세션 만료를 발급자 세션으로·위험 차단 해제 | `test:a11y:session`·`test:a11y:rate-limit` 을 새 세션으로 다시 통과, 차단→재인증→해제 시험 |
| 7 | JWKS 캐시 실증(T-M3-06) | 발급자 컨테이너를 멈춘 채 이미 로그인한 지원자의 저장·결제확인·제출 성공 |
| 8 | K8s 역할 6종 | kind 에서 `kubectl auth can-i` 행렬 시험(역할별 허용·거절) |
| 9 | 화면 시험 다시 | 접근성 시험 전부(로그인 화면 추가), `check:ui-copy`, 화면 캡처 갱신, ZAP DAST(토큰 붙여서) |

화면을 고치는 단계(5·6)는 AGENTS.md 규칙대로 접근성 시험을 다시 돌린다 — 로그인·재인증 화면은 포커스·오류 요약·
세션 경고 대화상자 규칙을 그대로 따른다.

## 4. 준비 상태 (2026-10-02 확인)

| 항목 | 상태 |
|---|---|
| Keycloak 이미지 | 내려받음 — `quay.io/keycloak/keycloak:26.8.0@sha256:b0f60d489d51c5d113390bdf5461d4c06e6051be026c05549f2e1e10ec352bcc`, 약 750MB, Docker 저장소(C 드라이브 아님) |
| 기동 확인 | 임시 렐름으로 기동 **79초**(kind 클러스터 2개가 떠 있는 상태), 메모리 **약 614MiB** / VM 7.5GB. discovery·JWKS(RS256)·토큰 발급·역할 클레임(`realm_access.roles`)·ACR 클레임 확인. 확인 뒤 컨테이너는 지웠다 |
| 포트 | 18080 — 저장소 어디에서도 쓰지 않는다 |
| 라이브러리 | `jose` 6.2.12(의존성 없음) — 단계 2에서 `server-kit` 에 더한다. **C 드라이브가 3.1GB 남았다** → 설치는 `npm install --cache E:\DockerData\npm-cache` 로 |
| 메모리 주의 | kind 클러스터 2개 + Keycloak + 로컬 서버 셋을 함께 띄우면 VM 7.5GB 에 빠듯하다(HANDOFF §3). 단계 7·8 은 kind 를 하나씩 |

## 5. AI 가 못 하는 것 (B·C 로 남는다)

- 실 본인확인(간편인증·PASS·공동인증서) 기관 연동과 그에 따른 주민번호 처리 결정 — 기관 계약·법무([10 §7](10-admission-privacy-and-legal-notices.md))
- 대학 IdP(대학 SSO) 연합 — 대학별 협조
- 운영 발급자의 키 보관(HSM/KMS)·KCMVP 판단 — 노션 06 Secret 절 그대로 기관 정책
- 노션 반영: 계약 `openIdConnectUrl` 예시값·범위↔역할 매핑·첨부 RBAC 3종→6종 — [06-notion-changeset.md](06-notion-changeset.md) 에 준비

## 6. 바로 시작할 첫 커밋

단계 1(로컬 발급자) → 단계 2(검증기·캐시)를 한 묶음으로. 두 단계는 화면을 건드리지 않아 다른 세션과 겹칠 일이 적다.
