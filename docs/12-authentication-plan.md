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
| A2 | 렐름 둘: **`wonseoro-staff`**(대학 담당자 — 비밀번호 + TOTP 필수, 역할 6종 → 2026-10-04 상담 담당 `support-agent` 를 더해 7종, D-79) · **`wonseoro-applicant`**(지원자 본인확인 흉내 — 실 간편인증·PASS 는 외부 기관, B/C) | 담당자와 지원자의 세션·정책·키를 섞지 않는다 |
| A3 | **API 가 토큰을 직접 검증한다 — `AUTH_MODE=oidc` 추가**(dev-headers·gateway 는 그대로 둔다) | 차트에 gateway 가 없고, T-M3-06 의 "중앙 IAM 이 끊겨도 이미 접속한 사용자는 계속" 은 **대학 쪽 JWKS 캐시**가 있어야 성립한다 |
| A4 | **JWKS 캐시는 `server-kit` 에 직접 둔다**(서명 검증은 `jose` 6.2.12) — 메모리 + 마지막으로 받은 키 묶음 보관, 모르는 `kid` 면 쿨다운을 두고 한 번만 다시 받기, 발급자가 죽어도 **최대 보관 시간까지 기존 키로 검증**, 키 나이 지표 | `jose` 의 원격 키 묶음은 발급자 장애 때 버틴다는 보장이 없다. 인수 시험이 "발급자 차단 중 검증 지속" 이다 |
| A5 | **역할 매핑**: 계약 범위 → 앱 역할 — `admin` → `admission-admin`, `operator` → `admission-admin`(대사는 업무다), `auditor` → `security-auditor`. platform-viewer·sre-operator·release-controller·break-glass 는 **업무 API 권한이 없다**(K8s 전용) | 노션 06: "admission-admin: 업무 Config API만, Kubernetes 권한 없음", "security-auditor: Audit/Security Read-only". 계약 범위 이름과 역할 이름이 달라 **대장 D-N 으로 올린다**(구현 첫 커밋에서 번호) |
| A6 | **MFA·step-up**: staff 렐름은 로그인 때 TOTP 필수(인증 수준 2 — 토큰에는 이름 `acr=mfa` 로 실린다). 운영 API 는 모든 경로에서 `acr=mfa` 를 요구. **민감 동작**(증적 패키지 열람, Config·마감 승인/활성화/되돌리기, 대사 예외 해결)은 `auth_time` 5분 이내 + **목적·사유 입력**을 요구하고, 넘으면 다시 인증(`max_age=0`)으로 보낸다 | T-M5-10 인수기준 "민감정보 조회 시 목적·사유 입력", STRIDE E-03 "server-side RBAC/ABAC; step-up; two-person approval" |
| A7 | **콘솔 로그인은 서버 쪽(BFF)** — Next.js 서버가 Authorization Code + PKCE 를 하고 토큰은 서버에만 둔다. 브라우저에는 `HttpOnly`·`Secure`·`SameSite=Lax` 세션 쿠키만 | 노션 06 App Security "Secure/HttpOnly/SameSite Cookie". 콘솔은 이미 서버에서 API 를 부른다(`lib/server.ts`) |
| A8 | **지원자 로그인은 공개 클라이언트 + PKCE** — 액세스 토큰은 메모리, 회전되는 갱신 토큰만 `sessionStorage`. 지원자 세션 무활동 30분은 **발급자 세션 설정(SSO Session Idle 30분)** 으로 옮기고, 5분 전 경고·"연장" 은 토큰 갱신으로 바꾼다 | 지금 화면은 브라우저에서 API 를 직접 부른다(CORS). `lib/session.ts` 한 곳만 바꾸면 된다(T-M5-45 에서 그렇게 모아 뒀다) |
| A9 | **지원자 등록**: 첫 인증 요청에서 토큰 `sub`(렐름별 가명)를 `subject_token` 으로 `applicant` 행을 만든다. 실명·주민번호 등은 받지 않는다(`pii_ciphertext` 는 필드 암호화 T-M5-06·실 본인확인과 함께) | 법정 고지 문서 [10 §6 G-7](10-admission-privacy-and-legal-notices.md) — 주민번호 수집은 본인확인 기관 연동 때 결정 |
| A10 | **위험 차단 해제(ADR-0009)**: 위험점수 차단 응답에 "다시 본인확인" 길을 알리고, 화면은 `max_age=0` 로 재인증한다. API 는 토큰 `auth_time` 이 차단 시각보다 새로우면 그 지원자의 차단을 푼다 | ADR-0009 · T-M5-02 인수기준 |
| A11 | **K8s 역할 6종**: 노션 첨부 `network-rbac.yaml` 은 고치지 않는다(R5). 차트 `templates/rbac.yaml` 에 security-auditor(조회 전용, Secret 없음)·break-glass(Role 만, **바인딩 없음 = 평소 비활성**)를 더하고 admission-admin 은 K8s 권한 0 을 시험으로 고정한다. 첨부와 차트 차이는 대장에 올린다 | 노션 06 역할 정의 그대로 |
| A12 | 운영 안전장치: 운영(`NODE_ENV=production`)에서 `AUTH_MODE=oidc` 의 발급자가 `http:`·`localhost`·로컬 렐름이면 기동 거부. oidc 모드에서는 `ADMIN_API_TOKEN` 을 쓰지 않는다 | R8 과 같은 결 — 개발 발급자가 운영에 섞이지 않게 |

## 3. 작업 순서와 인수 시험

| 단계 | 내용 | 끝났다고 말할 근거 |
|---|---|---|
| 1 ✅ | 로컬 발급자 — compose `auth` 프로필, 렐름 파일 2개(`infra/auth/`), 시험 담당자 6역할·지원자 2명·TOTP 시험 비밀(로컬 전용 시드값) | 기동 후 discovery·JWKS·역할 클레임·ACR 확인 스크립트 통과 — `test:auth:issuer` 24개 |
| 2 ✅ | `server-kit` OIDC 검증기 + JWKS 캐시 | 단위 시험: 서명·만료·발급자·대상(aud) 위조 거절, 키 회전, 발급자 차단 중 검증 지속, 모르는 kid 폭주 시 다시 받기 1회 |
| 3 ✅ | 대학 API `AUTH_MODE=oidc` — 지원자(`sub`→applicant), 운영 API 역할·ACR·step-up 가드, 2인 승인 신원을 토큰의 담당자로 | **수직 권한 시험**(역할×경로 전 조합, STRIDE E-03), 본인 승인 금지, 기존 소유권 시험(R10)·BOLA 시험 유지 |
| 4 ✅ | 중앙 API `AUTH_MODE=oidc` | 대시보드·프로필 금고가 토큰 가명으로만 동작 |
| 5 ✅ | 콘솔 로그인(BFF)·MFA·민감 동작 재인증·목적·사유 | 브라우저 시험: 로그인→TOTP→승인, 5분 지난 증적 열람은 재인증, 다른 역할은 메뉴·API 모두 거절 |
| 6 ✅ | 지원자 로그인·세션 만료를 발급자 세션으로·위험 차단 해제 | `test:a11y:session`·`test:a11y:rate-limit` 을 새 세션으로 다시 통과, 차단→재인증→해제 시험 |
| 7 ✅ | JWKS 캐시 실증(T-M3-06) | 발급자 컨테이너를 멈춘 채 이미 로그인한 지원자의 저장·결제확인·제출 성공 — 토큰 만료 뒤는 단절 유예(D-67) |
| 8 ✅ | K8s 역할 6종 | kind 에서 `kubectl auth can-i` 행렬 시험(역할별 허용·거절) — sre 수정 범위 승인 정책(D-68) |
| 9 ✅ | 화면 시험 다시 | 접근성 시험 전부(로그인 화면 추가), `check:ui-copy`, 화면 캡처 갱신, ZAP DAST(토큰 붙여서) |

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

## 6. 진행 기록

### 단계 1·2 ✅ (2026-10-03)

- **로컬 발급자** — `infra/compose/docker-compose.dev.yml` 의 `keycloak`(프로필 `auth`, :18080), 렐름 `infra/auth/wonseoro-staff.realm.json`·`wonseoro-applicant.realm.json`, 계정 안내 [infra/auth/README.md](../infra/auth/README.md).
  담당자 로그인 흐름은 Keycloak 의 인증 수준(LoA) 흐름 — 수준 1 비밀번호, 수준 2 TOTP(5분 지나면 다시). 콘솔 클라이언트는 최소 수준 `mfa` 를 요구한다
- **`npm run test:auth:issuer`** 24개 통과 — 사람이 하는 로그인 길(PKCE → 비밀번호 → OTP → code 교환)을 그대로 밟는다. 비밀번호만으로 토큰 없음, 토큰의 역할·대상·`acr=mfa`·`auth_time`·5분 수명,
  5분 안 재요청은 화면 없이 통과, `max_age=0` 재인증은 OTP 를 다시 묻고 인증 시각이 새로 찍힘, 틀린 OTP·비활성 break-glass 거절, 지원자 토큰은 역할 없음·대학·중앙 API 둘 다 대상
- **검증기** — `packages/server-kit/src/oidc/`(`OidcVerifier`·`JwksCache`, `jose` 6.2.12). 공개키 알고리즘만(none·HS* 거절), kid 필수, iss·aud·exp·iat·sub, 시계 오차 30초.
  토큰 탓은 `OidcTokenError`(401), 키를 쓸 수 없으면 `OidcUnavailableError`(503)로 나눈다. 단위 시험 17개(위조 서명·알고리즘 혼동·kid 폭주 시 한 번만 다시 받기·키 교체·2시간 단절·최대 보관 시간 초과 닫힌 실패·스냅숏 재기동·다른 발급자 discovery·비밀 키 성분 거절)
- **`npm run test:auth:verifier`** 11개 통과 — 실제 Keycloak 토큰을 검증하고, **발급자 컨테이너를 멈춘 채** 같은 검증기가 계속 검증, 발급자 장애 중 새로 뜬 검증기도 스냅숏 파일로 검증(Pod 재기동),
  스냅숏도 없으면 503. 다른 렐름 토큰은 키 단계(`unknown-key`)에서, 다른 대상은 aud 에서 거절
- `jose` 6 은 ESM 전용이라 Node 22.12 이상의 `require(esm)` 으로 읽는다 — `engines` 를 `>=22.12` 로 올렸다(CI·이미지는 Node 22 최신)

### 단계 3 ✅ (2026-10-03) — 대학 API `AUTH_MODE=oidc`

- **어디서 검증하나** — `app.setup.ts`(main 과 HTTP 시험이 같은 조립)가 요청마다 **요청 한도보다 먼저** 토큰을 검증해 `request.identity` 에 붙인다
  (`common/identity/oidc-auth.ts`). 경로 분류: `/admin/v1/**` 담당자 렐름, `/api/v1/**` 지원자 렐름, 계약의 `security: []` 4개(시각·운영 상태·공개키·PG 콜백)만 토큰 없이.
  소유권·요청 한도·감사는 이 신원만 본다 — 신원 헤더(`x-applicant-id`·`x-admin-id`·`x-authenticated-*`)는 oidc 에서 읽지 않는다
- **지원자 등록(A9)** — 처음 온 지원자 렐름 주체(sub)로 `applicant` 행을 만든다. 개인정보 없음(`pii_key_version='none'`, 빈 암호문) — 본인확인 기관 연동·필드 암호화 때 채운다
- **운영 API(A5·A6)** — 경로마다 `@AdminScope('admin'|'operator'|'auditor')`(계약 범위 그대로), 범위 → 역할 `SCOPE_ROLES`(admin·operator → admission-admin, auditor → security-auditor).
  범위가 안 붙은 운영 경로는 닫는다. 모든 운영 경로가 `acr=mfa` 를 요구하고, **민감 동작 8개**(설정 승인·활성화·되돌리기, 마감 연장·승인·활성화, 대사 예외 해결, 증적 열람)는
  `@StepUp` — 5분 안에 직접 인증했어야 한다. 아니면 401 `STEP_UP_REQUIRED` + `WWW-Authenticate: Bearer error="insufficient_user_authentication", acr_values="mfa", max_age=300`(RFC 9470).
  증적 열람은 원래부터 사유 필수다(D-24) — T-M5-10 의 "목적·사유 입력"
- **2인 승인·감사의 담당자** — 토큰의 `preferred_username`(없으면 sub). 작성자 본인 승인은 기존 업무 규칙이 막는다
- **오류** — `UNAUTHENTICATED`(401)·`STEP_UP_REQUIRED`(401)·`AUTH_UNAVAILABLE`(503, 발급자 키 없음) — 계약 패키지와 화면 문구표. 계약 범위↔역할 표·401 응답이 계약에 없는 것은 **대장 D-64**
- **운영 안전장치(A12)** — 발급자 주소는 운영에서 https·로컬 아님이어야 기동(`server-kit requireIssuerUrl`). oidc 모드에서는 `ADMIN_API_TOKEN` 을 쓰지 않는다
- **시험**
  - `oidc-routes.test.ts` 8개 — 실제 AppModule 컨트롤러를 훑어 경로 분류·권한 범위를 OpenAPI 와 구조로 대조, 재인증 경로 목록 고정
  - `admin.guard.oidc.test.ts` 6개 — 역할 6종 × 범위 3종 표, acr, 재인증 시각·`WWW-Authenticate`
  - `oidc-auth.integration.test.ts` 9개(실 PostgreSQL, 시험이 띄운 발급자) — 공개·보호 경로, 지원자 등록 한 번, **BOLA**(남의 원서·꾸민 헤더 404), 렐름 섞임 거절, 위조·만료·다른 대상 거절,
    역할별 운영 API 표, 비밀번호만 로그인 거절, 2인 승인이 토큰 신원으로(꾸민 `x-admin-id` 무시·작성자 승인 불가·10분 전 인증 재인증), 발급자 정지 중 검증 지속
  - **`npm run test:auth:api`** 19개 — 대학 API 를 oidc 로 띄우고 **실제 Keycloak 로그인 토큰**으로 끝에서 끝까지(지원자 등록·BOLA·역할별·2인 승인 기록 `admin-a`→`admin-b`)
  - admission-api 전체 352개(CI 재현 DB, 실패 0·건너뜀 3), server-kit 72개
- 렐름 시험 계정에 고정 id — Keycloak 을 다시 만들어도 sub 가 같다

### 단계 4 ✅ (2026-10-03) — 중앙 API `AUTH_MODE=oidc`

- 중앙의 지원자 API 는 공통원서(`/api/v1/profile`)·"내 원서"(`/api/v1/dashboard/applications`) 둘이다. 요청마다 먼저 **지원자 렐름** 토큰을 검증하고(대상 `wonseoro-central-api`),
  **토큰의 주체(sub)를 가명 토큰으로** 쓴다(`apps/central-api/src/oidc-auth.ts`, 조립은 `app.setup.ts`). 담당자 렐름 토큰·대학 전용 토큰은 401. 내부 경로(`/internal/**`, 대학 → 중앙)는 mTLS 몫(T-M5-05)
- 대학 API 와 **같은 렐름·같은 sub** 라 대학이 만드는 "내 원서" 참조(HMAC)와 공통원서 Snapshot 요청이 그대로 이어진다
- 시험
  - `oidc-auth.integration.test.ts` 6개 — 컨트롤러 경로를 계약과 대조(지원자 경로만 토큰), 토큰 없음·다른 렐름·대학 전용 대상·위조 401, 공통원서는 토큰의 주체로만(꾸민 헤더 무시), "내 원서", 발급자 정지 중 검증 지속
  - **`npm run test:auth:central`** 9개 — 중앙·대학을 oidc 로 띄우고 실제 Keycloak 로그인 한 번으로: 중앙에 공통원서 저장·이 대학 동의 → 대학에서 원서 생성 →
    **원서에 중앙 공통원서의 출신 고교가 들어온다**(두 API 가 같은 sub 로 이어짐), 다른 지원자·담당자 토큰 거절
  - central-api 전체 35개(실패 0), 보안 선별 시험 173개(건너뜀 0)

### 단계 5 ✅ (2026-10-03) — 운영 콘솔 관리자 로그인(BFF)

- **켜기** — 콘솔 서버 환경변수 `ADMIN_AUTH_MODE=oidc`·`ADMIN_OIDC_ISSUER`·`ADMIN_OIDC_CLIENT_ID/SECRET`·`ADMIN_PUBLIC_URL`·`ADMIN_SESSION_SECRET`(32자 이상). 로컬 값은 `scripts/auth/env/admin.env`,
  미리보기 `auth-admin`(:4100)·`auth-admission`(:3111). 운영에서 이 모드가 아니거나 설정이 모자라면(http·로컬 발급자 포함) 콘솔이 이유를 말하며 거절한다
- **로그인** — `/api/auth/login` → 발급자(Authorization Code + PKCE·state·nonce·`acr_values=mfa`) → `/auth/callback` 이 ID 토큰(서명·발급자·대상·nonce)을 확인하고
  토큰을 **AES-256-GCM 으로 봉인한 쿠키** 하나(HttpOnly·SameSite=Lax·운영 Secure)로 둔다. 브라우저 스크립트는 토큰을 볼 수 없다. 돌아갈 곳은 콘솔 안 경로만(`//evil` 거절)
- **중계** — `/api/admin/*` 가 쿠키를 풀어 `Authorization: Bearer` 를 붙인다(조회도 로그인 필요). 액세스 토큰이 30초 안에 끝나면 갱신 토큰으로 바꿔 쿠키를 새로 준다(인증 시각은 그대로).
  상태 변경은 `x-requested-with` 필수(다른 사이트의 요청 차단). 운영 API 의 403·401(`STEP_UP_REQUIRED`)·`WWW-Authenticate` 를 그대로 돌려준다
- **화면** — 머리글에 담당자 이름·역할(`STAFF_ROLE_LABEL`)·로그아웃. 로그인 전에는 본문을 그리지 않고 로그인 안내. 운영 API 가 재인증을 요구하면 "본인 확인을 한 번 더 해 주십시오" 안내로
  포커스를 옮기고(본문의 실패 안내 뒤에), "본인 확인 다시 하기" 가 발급자에 `max_age=0` 로 비밀번호·일회용 번호를 다시 받는다. 로그아웃은 발급자 세션도 끝낸다.
  목적·사유는 증적 열람이 이미 필수로 받는다(D-24)
- **함께 바뀐 것** — 모집·전형·모집단위 조회를 공개로(계약 1.7.0, **D-65** — 콘솔 머리글·로그인 전 지원자 화면). 렐름 로그인 화면을 한국어로
- **찾은 결함 D-66** — NestJS 11 의 CORS 기본 메서드(GET·HEAD·POST) 때문에 **브라우저가 원서 저장(PATCH)·공통원서 저장(PUT)·서류 삭제(DELETE)를 못 보내고 있었다**(10-02 부터). 접근성 키보드 완주가 잡았다. 두 API 에 메서드를 적고 사전 요청 시험을 더했다
- **시험**
  - **`npm run test:auth:console`** 21개 — 실제 콘솔 서버로 로그인 전 401·mfa·PKCE·nonce·비밀번호→일회용 번호·원래 화면 복귀·HttpOnly/SameSite·로그인 쿠키 삭제·쿠키 안 토큰 평문 없음·
    운영 API 중계·x-requested-with 없는 변경 403·**토큰 갱신**(인증 시각 유지)·꾸민 쿠키 401·다른 사이트로 돌려보내기 거절·감사자 증적 통과/설정 403·state 위조 실패·재인증 max_age=0·로그아웃
  - 화면 확인 — 실제 브라우저로 로그인, 30초 재인증 창으로 승인 → 재인증 안내(포커스) → 본인 확인 다시 하기 → 같은 승인 성공(기록 admin-a)
  - 접근성 — `focus-sweep admin-oidc`(로그인 전·키보드로 발급자 로그인·로그인 뒤 첫 화면·설정 승인) 1280·320 문제 0건, 개발 모드 콘솔 10화면 119자리·키보드 완주 92키 그대로 통과
  - admission-api 356·central-api 36(CORS 사전 요청 시험 포함)

### 단계 6 ✅ (2026-10-03) — 지원자 화면 본인확인

- **켜기** — 빌드 값 `NEXT_PUBLIC_AUTH_MODE=oidc`·`NEXT_PUBLIC_OIDC_ISSUER`·`NEXT_PUBLIC_OIDC_CLIENT_ID`. 로컬 `scripts/auth/env/web.env`·`central.env`, 미리보기 `auth-web`(:3001)·`auth-central`(:3112)·`auth-admission`(:3111)
- **로그인** — 공개 클라이언트 + PKCE·state·nonce(`apps/frontend/src/lib/auth.ts`, 콜백 `/auth/callback`). 토큰은 이 탭 sessionStorage 에만, 액세스 5분·갱신 토큰 회전. 화면 세션은 자리표시자만 가진다 —
  지원자 식별자는 서버가 토큰으로 정한다. API 호출 계층이 Bearer 를 붙이고(개발 신원 헤더 없음), 401 이면 한 번 갱신해 같은 요청을 다시 보낸다
- **세션 만료(A8)** — 무활동 30분·5분 전 경고(T-M5-45)는 그대로. 연장은 토큰 갱신도 해 발급자 무활동 시간을 민다. 발급자가 세션을 끝내면 같은 종료 안내. 끝나면 마지막 저장을 보낸 뒤
  갱신 토큰을 폐기해 **발급자 세션까지 끝낸다**(브라우저로 확인 — 옛 갱신 토큰이 `Session not active`), 다음 본인확인은 비밀번호를 다시 묻는다(공용 PC)
- **위험 차단 해제(A10, ADR-0009)** — 대학 API 가 위험 차단 429 에 재인증 신호를 싣고, 차단이 시작된 **뒤에** 직접 인증한 토큰이면 한 번 푼다(같은 인증으로 두 번은 안 된다).
  화면의 한도 안내에 "본인확인 다시 하기"(`max_age=0`) — 다녀와서 같은 버튼을 다시 누른다
- **로그아웃** — 접수 홈. 갱신 토큰 폐기 + 발급자 로그아웃 화면을 거쳐 홈으로
- **시험**
  - `throttle-reauth.integration.test.ts`(실 PostgreSQL) — 남의 원서를 훑어 위험 차단 → 429 + 재인증 신호 + Retry-After, 차단 전 인증 토큰은 계속 막힘, 다시 본인확인한 토큰은 통과. 단위 시험(같은 인증 두 번 금지)
  - 접근성 `focus-sweep applicant-oidc` 1280·320 문제 0건 — 키보드로 본인확인, 공통원서 저장, 원서 1단계, 위험 차단 안내의 "본인확인 다시 하기" → `max_age=0` → 원서로 돌아옴, 로그아웃(토큰 지워짐)
  - 개발 모드 회귀 — 키보드 완주 92키·지원자 19화면 171자리·세션 만료 13·한도 해제 8 모두 그대로 통과
  - admission-api 358, 보안 선별 시험 175개(건너뜀 0), 지원자 화면 운영 빌드 통과

### 단계 7 ✅ (2026-10-03) — 발급자 정지 실증 (T-M3-06)

- **드러난 틈** — 키 캐시는 이미 받은 토큰의 서명을 계속 검증하게 해 줄 뿐이다. 지원자 액세스 토큰은 5분이고 갱신은 발급자에게 해야 해서,
  발급자가 끊기면 5분 뒤 모든 지원자가 로그인 끝으로 처리된다 — "이미 접속한 사람은 계속" 이 5분이었다
- **단절 유예(D-67)** — `OidcVerifier` `outageGraceMs`. 만료된 토큰을 ① 발급자에 지금 닿지 않을 때(`JwksCache.issuerReachable()` — 키를 다시 받아 본다,
  쿨다운 30초에 한 번) ② 만료 2시간 안 ③ 발급자에 마지막으로 닿은 뒤 만료된 것만 받는다. 서명·발급자·대상은 만료 직전 시각으로 그대로 검사한다.
  **지원자 토큰만**(대학·중앙 API `OIDC_APPLICANT_OUTAGE_GRACE_MS`, 0 이면 끔) — 담당자 토큰은 유예 없음. 지표 `auth_decisions{result="grace"}`, 경고 로그 1분에 한 줄.
  화면(`lib/auth.ts`)은 갱신이 발급자에 닿지 못하면 쓰던 토큰을 만료 뒤에도 보내고 30초 동안 갱신을 다시 시도하지 않는다
- **실증 `npm run test:auth:offline`** — 15개 통과, 409초(축소 환경 — 2시간 대신 액세스 토큰 1회 만료). 시험 지원자는 관리 API 로 매번 새로 만들고 끝나면 지운다
  - 발급자 컨테이너 정지 → 지원자 A 원서 생성·저장·결제 확인·접수(406ms)
  - 정지 중 API 재기동 → 디스크 스냅숏의 공개키로 접수증이 열린다
  - 토큰이 끝난 지 75초 → 지원자 B 가 처음부터 접수까지(유예로 받은 요청 5건 지표), 담당자 만료 토큰은 401
  - 유예를 60초로 줄여 띄운 API 는 같은 토큰을 거절 — 유예는 끝이 있다
  - 발급자 복구(19초) → 24초 뒤 만료 토큰 다시 401, 갱신 토큰으로 새 토큰을 받아 이어 간다
- **브라우저 확인** — 본인확인 모드 지원자 화면에서 원서를 연 채 발급자를 멈추고 토큰이 끝난 지 약 90초 뒤 원서 저장 → DB 반영(버전 2)·화면 세션 유지·서버 경고 로그.
  접근성 `focus-sweep applicant-oidc` 1280 문제 0건 그대로
- **시험** — server-kit 단위 시험 7개 추가(79), admission-api 358·central-api 36 통과

### 단계 8 ✅ (2026-10-03) — Kubernetes 역할 6종 (D-68)

- **차트 `templates/rbac.yaml`** — 첨부의 3종(platform-viewer·sre-operator·release-controller)에 더해
  - security-auditor — Role·바인딩·NetworkPolicy·ServiceAccount·Pod·Deployment·PDB·이벤트 조회. Secret·로그·exec 없음. 감사 그룹은 첨부대로 platform-viewer 도 받는다
  - break-glass — Role 만, **바인딩 없음 = 평소 비활성**. `rbac.breakGlass.group` 으로 켜되 끝나는 시각·사유가 없으면 렌더링을 거부한다(바인딩 annotation 에 남는다).
    TTL 회수·사용 경보는 T-M5-03. RBAC 변경·exec·Pod 삭제 없음
  - admission-admin — Role·바인딩 없음(Kubernetes 권한 0). 조회 그룹 `kadmission-viewers` 바인딩 추가
  - 차트 Role 은 배포 계정(gitops release-controller) 권한의 부분집합이어야 한다 — Kubernetes 가 자기 권한 밖의 Role·바인딩 생성을 막는다
- **드러난 틈(D-68)** — sre-operator 의 재시작은 Deployment patch 인데, RBAC 은 필드를 가르지 못해 Secret 을 읽을 권한 없이 Pod 틀에 `secretKeyRef` 를
  넣고 로그로 볼 수 있었다(kind 재현). **플랫폼 승인 정책** `deploy/platform/rbac/sre-operator-guard.yaml`(ValidatingAdmissionPolicy, k8s 1.30+) —
  sre 그룹의 Deployment 수정은 replicas·재시작 표시만. 클러스터 범위라 플랫폼 관리자가 적용(kind-univ-a 에 적용해 둠)
- **시험 `npm run test:auth:k8s`**(kind-univ-a, v1.37.0) — 25개 확인(행렬 110칸 포함) 통과, 58초
  - 역할별 허용·거절: viewer 16·sre 17·auditor 18·admission-admin 13(전부 거절)·break-glass 평소 9(전부 거절)·켠 동안 14·끈 뒤 9, 모든 사람 역할에 클러스터 범위·RBAC 변경·exec 없음
  - sre: 재현(정책 없이 Secret 참조 patch 성공) → 정책 뒤 Secret 참조·이미지·라벨·다른 annotation 거절, 재시작·scale·replicas patch 통과, 플랫폼 관리자는 걸리지 않음
  - 배포 계정과 같은 Role 의 계정이 차트 RBAC(Role 5·바인딩 4)을 실제로 만든다(권한 상승 검사 통과), 실제 배포 계정은 다른 네임스페이스·클러스터 범위·승인 정책 변경 불가
- **함께** — runtime 첨부 다시 렌더링(v1.3, 38,186바이트 — 06 changeset), IaC 검사(Trivy 0.75.0 High/Critical) 0건, `gitops-manifests` 통과

### 단계 9 ✅ (2026-10-03) — 화면 시험 다시 · 인증 끝

- **로그인 서버 화면 접근성** — `focus-sweep issuer`(지원자 본인확인·로그인 실패 안내·관리자 로그인·일회용 번호). Keycloak 기본 테마에서 **22건**
  (포커스 표시가 거의 안 보임 20, 오류 칸이 오류 문장을 설명으로 갖지 않음, 일회용 번호 화면의 이름 없는 칸, 320px 말풍선 가로 스크롤).
  **원서로 로그인 테마** `infra/auth/themes/wonseoro`(keycloak.v2 를 이어받아 CSS·스크립트만 더한다, compose 가 붙이고 두 렐름 `loginTheme`)로 고쳐
  1280·320·Edge·글자 200% 0건 — [09](09-accessibility.md)
- **접근성 전체 다시** — 개발 모드 지원자·콘솔, 로그인 모드 콘솔·지원자, 로그인 서버 — 모두 0건. `check:ui-copy` 통과
- **화면 캡처 35장** — 개발 모드 27장 다시(접근성 작업 뒤 처음) + 로그인 모드 8장(28~35: 본인확인 전·로그인 서버·본인확인 뒤·위험 차단 본인확인 다시 하기·
  콘솔 로그인 전·일회용 번호·로그인 뒤·민감 동작 재인증). 모두 렌더링 문구 검사 통과 — [screenshots](screenshots/README.md)
- **토큰 붙인 ZAP DAST** — 전에는 개발 신원 헤더 없이 검사해 지원자·운영 API 대부분이 신원 확인에서 멈췄다. 이제 대학 API 를 oidc 모드로 띄우고
  시험 발급자(`scripts/security/dast-issuer.mjs` — 실제 Keycloak 토큰과 같은 모양, 비밀 키는 메모리에만)의 토큰을 ZAP 시작 훅(`zap-auth-hook.py`)이
  경로별로 붙인다(`/api/v1` 지원자, `/admin/v1` 담당자 — `-z` 로 넘기면 ZAP 이 값을 공백에서 잘라 "Bearer" 만 남았다).
  ZAP 이 토큰을 못 붙이면 보고서는 High 0 으로 "통과" 하므로 **인증 도달 확인**(`check-dast-auth.mjs` — 토큰 판정 지표)을 게이트에 더했다.
  로컬·원격(Security run 37108004422) 같은 결과: **WARN 0·High 0·PASS 118**, 인증 뒤까지 닿은 요청 지원자 1,236·담당자 3,036, 서버 오류 로그 0. 로컬 실행 `node scripts/security/dast-local.mjs`
- **함께** — 화면 캡처 준비 스크립트가 지우던 상태 파일 경로를 저장소 `.cache/shots` 로 맞췄다(전에는 C 드라이브 임시 폴더를 가리켰다)

### 인증 다음

T-M5-02·10 은 끝났다. 남은 것 — 실 본인확인 기관 연동·운영 발급자(기관 계약, [10 §7](10-admission-privacy-and-legal-notices.md)),
break-glass 의 짧은 TTL·사용 즉시 경보(T-M5-03), 노션 반영(D-64·D-65·D-67·D-68, [06](06-notion-changeset.md)).

## 7. 운영 경보 (2026-10-05, D-93)

발급자 장애는 로그뿐이었다 — `auth_decisions_total{audience,result}`(대학·중앙 API 모두)로 `IssuerKeysUnavailable`(키를 못 써 토큰 판단 불가 — 거절 중, critical)·`IssuerOutageGraceInUse`(단절 유예 D-67 로 받는 중, warning)를 받는다. 대응은 [문서 14 「경보 대응표」](14-operations-automation.md#경보-대응표). 권한 부여·변경·말소 기록 수집은 `AccessGrantSyncStale`(차트 schedule 주기의 세 배, 최소 3시간)·`AccessGrantSyncFailing`.
