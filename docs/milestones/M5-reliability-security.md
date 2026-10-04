# M5 — 신뢰성 · 보안 · 접근성

| | |
|---|---|
| **목표** | 실제 대학에 넣을 수 있는 보안·접근성 수준을 만든다 |
| **완료 기준** | CI 보안 게이트 10종 통과, 키보드만으로 전체 접수 완료, DR 전환 훈련 성공 |
| **선행 조건** | M4 종료 체크리스트 완료 |
| **주 담당** | 송리안 (보안·DR) / 권민준 (접근성·CI) |

## 노션 확인 대상

| 문서 | 이 단계에서 보는 이유 |
|---|---|
| [06. NetworkPolicy·RBAC·Vault](https://app.notion.com/p/3df75ab5debe81e0aab2e000ccdebba7) | **주 설계서.** Default Deny, RBAC 6역할, Secret 계층 |
| [09. STRIDE](https://app.notion.com/p/3df75ab5debe81e4bff5f44e1e3112d4) | 위협별 대응, 고위험 Abuse Case, Security Acceptance |
| [v1.0 §8](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 보안 아키텍처, CI/CD Security Gate 10종 |
| [v1.0 §7](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 구간별 통신 규격 (TLS/mTLS) |
| [v1.0 §10.3·§12.4](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | DR 목표, 접근성 Acceptance |
| [v1.0 §2](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 적용 규정 기준선 — 대학 법적 지위에 따른 적용범위 |

## 태스크

### 보안 (송리안)

| ID | 태스크 | 근거 노션 | 인수기준 |
|---|---|---|---|
| T-M5-01 | Network Default Deny | §06 | 허용경로 6종만, 대학 간 route 금지 |
| T-M5-02 | RBAC 6역할 적용 | §06 | platform-viewer / sre-operator / admission-admin / security-auditor / release-controller / break-glass. 지원자 본인확인을 붙일 때 **위험점수 차단을 본인확인 다시 하기(step-up)로 해제**하는 길과 세션 만료·연장을 인증 세션으로 옮긴다(ADR-0009, T-M5-45 `lib/session.ts`) |
| T-M5-03 | Break-glass 계정 | §06, §01 A7 | 평시 disable, 짧은 TTL, 사용 즉시 경보 |
| T-M5-04 | Vault/KMS 대학별 path 분리 | §06 | DB dynamic credential, mTLS 인증서 short TTL |
| T-M5-05 | Service mTLS | v1.0 §7.1 | 내부 통신 평문 금지, Zero Trust |
| T-M5-06 | Field-level 암호화 / Tokenization | v1.0 §8.3 | 고위험 필드 별도 암호화, KEK/DEK 분리 |
| T-M5-07 | SSRF Egress Allowlist | §09 | PG·중앙·인증기관만, Metadata 차단 |
| T-M5-08 | 파일 magic-byte + AV 실연동 | §09 | Zip Bomb·실행파일·매크로 차단 |
| T-M5-09 | BOLA 방어 | §09 | Cross-user/Cross-university 객체 접근 0 |
| T-M5-10 | Admin MFA + Step-up | §06 | 민감정보 조회 시 목적·사유 입력 |

> **T-M5-02·10 착수 (2026-10-03)** — 계획·결정은 [12-authentication-plan.md](../12-authentication-plan.md). 단계 1·2 끝: 로컬 Keycloak 26.8.0
> (담당자 렐름 비밀번호+TOTP·역할 6종, 지원자 렐름), `server-kit` 토큰 검증기·JWKS 캐시(단위 17개), 실제 발급자로 로그인 길 24개·
> 발급자 정지 중 검증 11개 통과. **단계 3 끝(2026-10-03)**: 대학 API `AUTH_MODE=oidc` — 지원자 첫 로그인 등록, 운영 API 경로마다 계약 범위
> → 역할(D-64), 비밀번호+OTP 필수, 민감 동작 8개 5분 재인증(RFC 9470), 2인 승인 신원을 토큰으로. 수직 권한·BOLA·실제 Keycloak 끝에서 끝까지
> 시험 통과. **단계 4 끝**: 중앙 API(공통원서·"내 원서")도 같은 지원자 토큰 — 실제 로그인 한 번으로 중앙에 쓴 공통원서가 대학 원서에
> 들어오는 것까지 확인. **단계 5 끝**: 운영 콘솔 관리자 로그인(BFF — 토큰은 서버 봉인 쿠키에만, PKCE·nonce·mfa, 토큰 갱신, 재인증 안내와
> `max_age=0` 재로그인, 로그아웃). 개발용 담당자 지정은 로그인 모드에서 사라진다. 접근성 다시 통과. 이 과정에서 **D-66**(NestJS 11 CORS 기본
> 메서드로 브라우저 PATCH·PUT·DELETE 가 막혀 있던 결함)을 찾아 고쳤다. **단계 6 끝**: 지원자 화면 본인확인(공개 클라이언트 + PKCE), 세션 만료와
> 발급자 세션 연결(끝나면 발급자 세션까지 폐기), **위험 차단을 본인확인 다시 하기로 해제**(ADR-0009 — 서버·화면·시험). **단계 7 끝**: 발급자 컨테이너를 멈춘 채 접수·API 재기동·토큰 만료 뒤
> **단절 유예**(D-67 — 지원자 토큰만, 발급자에 닿지 않는 동안·만료 2시간 안) 실증(`test:auth:offline`, T-M3-06 마무리). **단계 8 끝**: Kubernetes 역할 6종(security-auditor·break-glass 바인딩 없음·admission-admin 권한 0),
> sre 의 재시작 권한이 Secret 참조를 넣는 길이던 것을 플랫폼 승인 정책으로 막음(D-68), kind 행렬 110칸(`test:auth:k8s`). **단계 9 끝 — T-M5-02·10 완료**: 로그인 서버 화면 접근성(기본 테마 결함 22건 → 원서로 로그인 테마),
> 접근성 전체 다시 0건, 화면 35장, 토큰 붙인 ZAP DAST(WARN 0·High 0, 인증 뒤 요청 4,272건).

> **보안 통제 착수 (2026-10-03, [13](../13-security-controls-plan.md))** — 단계 1 끝: 서비스 간 상호 TLS(T-M5-05)·대학 신원 묶기(T-M5-09 대학 간). 계약이 mutualTLS 를
> 요구한 내부 경로 여섯이 인증 없이 열려 있던 결함(D-69)을 고쳤다 — 다른 대학 사칭 이벤트·남의 공통원서·서류 검사 위조가 403. 실제 TLS 실증 25개.
> 단계 2 끝: 출구 허용 목록(T-M5-07 — 의존 서비스 호스트만, 메타데이터 주소 거절, 서류 워커 서명 URL SSRF 차단)·NetworkPolicy 자동 시험(T-M5-01 — kind 두 대학 72칸).
> 단계 6 끝: 실 clamd(T-M5-08 — 실 clamd 가 먼저 끊으면 워커가 멈추던 결함, PDF 능동 콘텐츠 거절, Zip·PDF 폭탄 경보, D-73). **보안 통제 끝.**
> 단계 5 끝: break-glass(T-M5-03 — 끝나는 시각 전에만 렌더링·매분 회수 작업·경보 이벤트, DB 비상 계정은 Vault 15분·기록·문장 로그, D-72).
> 단계 4 끝: Vault(T-M5-04 — 첨부 정책 그대로 + 워크로드별 PKI 역할(D-71), Transit KEK·DB 동적 계정 무중단 교체·PKI 짧은 인증서, 실증 22개).
> 단계 3 끝: 필드 암호화(T-M5-06 — 원서 항목 값 전부·공통원서 금고를 봉투 암호화, KEK 교체·rewrap, 키 없으면 닫힌 실패, D-70).

> **T-M5-08 착수 (2026-09-30, D-58)** — magic-byte 검사는 M1 부터 있다. AV 는 ClamAV(clamd INSTREAM) 어댑터·서명 URL 다운로드·해시 대조·엔진 버전 기록까지 구현하고
> 같은 프로토콜의 가짜 clamd 로 시험했다(서류 워커 시험 8개). **남은 것: 실 clamd·서명 DB 로 확인**(이미지 내려받기 필요), Zip Bomb·매크로 문서 판정 확인, clamd 배치.

### CI 보안 게이트 (권민준) — v1.0 §8.4 10종

| ID | 게이트 | 통과 기준 |
|---|---|---|
| T-M5-20 | 1. Secret Scan ✅ 2026-10-02 | plaintext secret commit 0 |
| T-M5-21 | 2. SAST ✅ 2026-10-02 | Critical 0 |
| T-M5-22 | 3. Dependency/SCA + CVE ✅ 2026-10-02 | Critical 0 |
| T-M5-23 | 4. SBOM 생성 ✅ 2026-10-02 | 릴리스마다 첨부 |
| T-M5-24 | 5. Container Image Scan ✅ 2026-10-02 | Critical 0 |
| T-M5-25 | 6. IaC/K8s Manifest Scan ✅ 2026-10-02 | 정책 위반 0 |
| T-M5-26 | 7. Unit/Integration Security Test ✅ 2026-10-02 | 통과 |
| T-M5-27 | 8. DAST/Staging Scan ✅ 2026-10-02 | High 0 |
| T-M5-28 | 9. Image Signing ✅ 2026-10-02 | 전 이미지 서명 |
| T-M5-29 | 10. Admission Controller ✅ 2026-10-02 | **미서명 이미지 배포 거부 실증** |

> **T-M5-20·22 완료 (2026-10-02)** — `.github/workflows/security.yml`에 Gitleaks 8.30.1 Git 전체 이력 검사와 운영 의존성 SCA를 추가했다.
> 로컬에서 126개 커밋을 검사해 실제 비밀 0건을 확인했다. 시험 결과의 `subjectToken`과 단위 시험 키가 이름 때문에 잡힌 39건은
> `.gitleaks.toml`에서 시험 값 형식만 좁게 제외했다. NestJS 10→11과 관련 패키지 갱신으로 운영 의존성은
> **Critical 1→0, High 2, Moderate 2**다. `scripts/check-security-deps.mjs`가 Critical 0을 강제한다.
> 원격 Security 워크플로까지 통과했다(Actions run 36887597976). 남은 High는 Fastify 5.11.3·PostCSS 8.4.31이다.

> **T-M5-21·23 완료 (2026-10-02)** — CodeQL JavaScript/TypeScript `security-extended` 분석과 SPDX 2.3 SBOM 잡을 같은 워크플로에
> 병렬로 추가했다. CodeQL SARIF의 `security-severity` 9.0 이상을 직접 실패시키는 판정기와 경계값 단위 시험을 두었다.
> SBOM은 재현 가능한 `package-lock.json`을 Syft 1.52.0으로 카탈로그화하며, 로컬 결과는 패키지 266개·관계 1,054개다.
> 일반 CI에서는 워크플로 산출물로 보관하고 `release.published`에서는 릴리스 자산으로 자동 첨부한다. 원격 Security 워크플로 세 잡이 모두 통과했다(Actions run 36887597976).

> **T-M5-24·25 완료 (2026-10-02)** — Trivy 0.75.0으로 서비스 4종·PgBouncer 실제 이미지를 빌드해
> OS·라이브러리 Critical 0을 확인했다. Helm·Kubernetes·Dockerfile 설정 파일 19개도 High/Critical 0이다.
> namespace 한정 release-controller의 Service·NetworkPolicy 동기화 권한 `KSV-0056`만 파일 네 곳·2027-01-31 만료로
> 제한해 허용했다. 세부 결과와 재실행 범위는 [11-security-pipeline.md](../11-security-pipeline.md). 원격 Security workflow의 이미지 matrix 5잡과 IaC 잡도 통과했다(Actions run 36890582638).

> **T-M5-26 착수 (2026-10-02)** — 공용 설정·가명화·로그 마스킹, 대학 권한·감사·결제·입력 방어,
> 파일 검사 엔진 실패 폐쇄, 중앙 재전송·위장 발신·개인정보 최소화 시험을 별도 Security 잡으로 묶었다.
> 실 PostgreSQL 대학·중앙 DB에서 로컬 **123개 통과·건너뜀 0**이다. TAP 요약을 검사하므로 DB 미연결로 통합시험이
> 건너뛰어지는 경우도 실패한다. 원격 Security와 일반 CI도 통과했다(Actions run 36898652054·36898651960).

> **T-M5-27 완료 (2026-10-02)** — ZAP 2.17.0 OpenAPI active scan으로 로컬 실제 API·PostgreSQL의 81개 URL을
> 검사했다. 첫 스캔이 찾은 잘못된 UUID·정수 쿼리의 500, `/meta/time` 무인자 500, `nosniff` 누락을 고쳤다.
> 같은 조건 재실행은 로컬·원격 모두 **WARN 0·High 0·PASS 118**이다. JSON 보고서의 실제 site와 High 수를 별도 판정하며
> HTML·JSON 보고서를 CI 산출물로 14일 보관한다(Actions run 36902632192·36902632233).

> **T-M5-28 완료 (2026-10-02)** — Security 워크플로에 릴리스/수동 이미지 발행 잡을 추가했다. 운영 이미지 5종을
> GHCR에 발행하고 태그가 아닌 registry digest를 Cosign 3.0.6 GitHub OIDC 신원으로 서명한다. 같은 잡이 정확한
> `security.yml@<git ref>` 신원과 GitHub OIDC 발급자를 검증하고 이미지별 reference·검증 JSON을 90일 보관한다.
> 실제 5종 발행·서명·검증이 모두 통과했다(Actions run 36903506905).

> **T-M5-29 완료 (2026-10-02)** — 운영 `ClusterImagePolicy`는 `security.yml@refs/tags/*`의 GitHub OIDC
> 신원만 강제한다. Security 후속 잡은 임시 kind·Sigstore Policy Controller에서 서명 digest의 server dry-run
> admission 허용과 별도 미서명 digest 거부를 모두 확인한다. 미서명은 `policy.sigstore.dev` webhook 이 첫 확인에서
> 거부했고 서명 digest 는 통과했다(Actions run 36906282615). 첫 실행의 "미서명 통과"는 dry-run 값을 띄어 써서 webhook 이
> 불리지 않은 시험 결함이었다 — 고치고 정적 검사로 막았다.

### 접근성 (권민준) — v1.0 §12.4 / §07

> **2026-10-01** T-M5-40~46 ✅, T-M5-47 🟡. 시험·찾은 결함·고친 것·지원 브라우저는 **[09-accessibility.md](../09-accessibility.md)**. 시험은 `tests/a11y/`(설치 없이 Chrome·Edge 를 DevTools 프로토콜로 조작).

| ID | 태스크 | 인수기준 |
|---|---|---|
| T-M5-40 | 키보드 전용 접수 완주 ✅ 2026-10-01 | 1~6단계 + 완료까지 마우스 없이 |
| T-M5-41 | Visible Focus / Focus Order ✅ 2026-10-01 | 전 화면 |
| T-M5-42 | Screen Reader 검증 ✅ 2026-10-01 | Label·Error·Step·Status 전달 (접근성 트리 재료 — 실제 스크린리더 청취는 T-M5-48) |
| T-M5-43 | 200% 확대 ✅ 2026-10-01 | 기능 손실 없음 |
| T-M5-44 | 모바일 320 CSS px ✅ 2026-10-01 | 가로 스크롤 없음 |
| T-M5-45 | Session Timeout 사전 경고 ✅ 2026-10-01 | 입력 유실 전 경고 + 연장 옵션 |
| T-M5-46 | CAPTCHA 대체수단 ✅ 2026-10-01 | 접근 가능한 경로 제공 (ADR-0009 — 퍼즐형 CAPTCHA 를 두지 않는다) |
| T-M5-47 | 브라우저 상호운용 🟡 2026-10-01 | Chrome/Edge/Safari/Firefox + 모바일 — Chrome·Edge·휴대전화 흉내 통과, 실물 Firefox·Safari 는 사람 |
| T-M5-48 | KWCAG 2.2 자동 + **수동** 검사 | 자동만으로 끝내지 않는다 |

### 화면 제품화 (권민준)

> **2026-10-01 추가.** 지금 화면에는 개발자가 개발자에게 하는 말이 섞여 있다. 설계·구조 설명, 설계 문서 번호, 내부 코드·버전, 개발용 입력, 검증기 영문 원문이 그런 예다.
> 이것을 걷어내고 운영 수준으로 올린다. **디자인(배치·색·컴포넌트)은 바꾸지 않는다** — 글·표기·빠진 상태, 그리고 노션 첨부 와이어프레임과 다른 점만 다룬다.
> 두 앱·KRDS 부품·화면에 뜨는 서버 문구를 전수 점검해 59개 항목(U-1 ~ U-59)을 찾았다. 항목별 위치·현재 문구·바꿀 방향, 결정 16개, 회귀 방지 검사는
> **[08-ui-production-readiness.md](../08-ui-production-readiness.md)** 에 있다. 접근성(T-M5-40~47)과 같은 파일을 만지니 함께 한다.

| ID | 태스크 | 항목 | 인수기준 |
|---|---|---|---|
| T-M5-50 | 설계·구조 설명과 설계 문서 번호를 화면에서 걷어낸다 ✅ 2026-10-01 | U-12·17·32·36·39·44·46·52·54 | 화면 문자열에 `§`·`D-N`·`T-Mx`·`v1.x`·"기술설계서"가 0개, "중앙·원본" 같은 구조 설명이 0개. 소스 문구 검사(`scripts/check-ui-copy.mjs`)가 CI 에서 통과 |
| T-M5-51 | 내부 코드·식별자·버전 대신 사람 말로 보인다 ✅ 2026-10-01 | U-7·10·19·22·23·24·29·31·37·40·42·43·45·48·49·50·53 | 지원자 화면에 영문 대문자 코드·UUID·버전 문자열이 0개, 콘솔은 사람 말이 앞에 온다. 사람 말 사전은 `@wonseoro/contracts` 한 곳에 두고, 사전에 빠진 값이 있으면 시험이 실패한다. 계약 변경 둘(U-7 접수 이벤트 표시 이름·U-22 동의 대학 이름)은 노션 첨부 교체를 함께 한다 |
| T-M5-52 | 오류·검증 문구를 지원자·담당자 말로 바꾼다 ✅ 2026-10-01 | U-1·2·25·26·28·41 | 계약의 오류 code 전부에 화면 문구가 있다(빠지면 시험 실패). 검증 문구는 서버가 한국어와 항목 이름으로 만든다. 화면에 영문 오류·HTTP 번호가 0개. 오류 요약 항목을 누르면 그 칸으로 간다 |
| T-M5-53 | 개발용 신원 입력을 개발 모드에 가둔다 ✅ 2026-10-01 | U-20·21·38 | 개발 서버(`next dev`)에서만 그린다(`NEXT_PUBLIC_DEV_IDENTITY=0`·`ADMIN_DEV_OPERATOR=0` 으로 끈다). 운영 빌드에 1 을 주면 빌드가 멈춘다(R8 과 같은 방식). 시드 값이 화면 문구에 없다. **완료** — 운영 번들에 시드 값 0곳, 운영 콘솔은 담당자 쿠키 무시·지정 403 ([08 「진행」](../08-ui-production-readiness.md#진행)) |
| T-M5-54 | 날짜·시각·이름·아이콘 표기를 통일한다 ✅ 2026-10-01 | U-4·15·16·18·47 | 두 앱이 표기 함수 하나(`@wonseoro/krds`)를 쓰고, 표기는 와이어프레임 형식(`2026.12.31 18:00`)이다. 콘솔 마감 입력은 한국 시간으로 고정한다. 이모지 아이콘이 0개 |
| T-M5-55 | 불러오는 중·없음·오류 상태와 기본 페이지를 갖춘다 ✅ 2026-10-01 | U-8·9·13·14·33·34·35·59 | 모든 조회 화면이 세 상태를 나눈다. 한국어 404·오류 화면이 있다. 화면마다 제목이 있다. 접수증 인쇄에 메뉴·버튼이 없다. 오래 걸리는 요청은 안내한다 |
| T-M5-56 | 흐름 결함과 와이어프레임 차이를 고친다 ✅ 2026-10-01 | U-3·5·6·11·27·30·51(선택)·55·56·57·58 | 각 항목 해소 → 화면 27장을 다시 찍고 렌더링 문구 검사(`capture.mjs --check-copy`)를 통과한다 |

### DR (송리안)

| ID | 태스크 | 근거 노션 | 인수기준 |
|---|---|---|---|
| T-M5-60 | Multi-AZ Primary/Standby | v1.0 §10.3 | 동기 복제 — DB 역할·동기 streaming·계보·WAL 지연 자동 점검 준비, zone 증적·실배치 대기([14](../14-operations-automation.md)) |
| T-M5-61 | PITR + 원격지 백업 소산 | v1.0 §10.3 | 다른 장애영역 — archive 설정 자동 점검 준비, 원격 소산·실 PITR 복구 증적 대기([14](../14-operations-automation.md)) |
| T-M5-62 | **Restore Verification 자동화** | §01 B10 | 월별 자동 복구 + checksum/row-count/업무 invariant — ✅ 2026-10-03 `scripts/ops/restore-verify.mjs`·매달 CI([14](../14-operations-automation.md)) |
| T-M5-63 | Writer Fencing + Promotion Lock | §01 A10 | Split-brain 방지, 단일 Writer — ✅ 2026-10-03 쓰기 세대·문장 트리거·승격 잠금(D-76, [14](../14-operations-automation.md)) |
| T-M5-64 | DR 전환 훈련 | v1.0 §10.3 | RTO 15분 / RPO 0~1분 실측 — writer token/epoch 사전 점검·문서 18 런북 준비, 실제 전환 대기 |
| T-M5-65 | 인증서·Secret 만료 사전경보 | §01 B9 | 30/14/7/3/1일, rotation drill — ✅ 2026-10-03 만료 지표·경보 규칙·교체 훈련([14](../14-operations-automation.md)) |

## 종료 체크리스트 — 노션 §09 Security Acceptance

- [ ] Cross-user / Cross-university object access 0
- [ ] Finalized 일반수정 API 없음
- [ ] Unsigned image 실행 0
- [x] Secret plaintext Git commit 0 — Gitleaks 8.30.1 전체 이력 검사, 로컬·원격 통과 (2026-10-02)
- [ ] Critical Config 단독승인 불가
- [ ] 운영계정 Audit 삭제 불가
- [ ] Replayed Event가 상태를 중복 변경하지 않음
- [ ] 키보드만으로 전체 접수 완료
- [x] 화면에 설계 설명·설계 문서 번호·내부 코드·개발용 안내가 없다 — 소스·렌더링 문구 검사 통과, U-1~U-59 해소 (2026-10-01, U-51 은 선택 — T-M6-07) ([08](../08-ui-production-readiness.md))
- [ ] DR 전환 훈련 RTO/RPO 목표 달성
- [ ] **노션 §06·§09를 다시 읽고** 실제 적용 결과 반영
- [ ] 새로 식별된 위협을 §09 STRIDE register에 추가
- [ ] 대학 법적 지위별(국공립 / 사립) 적용범위를 v1.0 §18 Profile에 반영
- [ ] 발견한 불일치를 D-N으로 등록·처리
