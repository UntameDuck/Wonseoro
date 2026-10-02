# 로컬 OIDC 발급자 (개발 전용)

인증 단계 1 — [docs/12-authentication-plan.md](../../docs/12-authentication-plan.md) A1·A2.
Keycloak 26.8.0(고정 digest)을 `start-dev` 로 띄우고, 이 폴더의 `*.realm.json` 두 개를 시작할 때 읽어 들인다.

```bash
docker compose -f infra/compose/docker-compose.dev.yml --profile auth up -d keycloak   # 약 75초
npm run test:auth:issuer      # 로그인 길·토큰 내용 24개 확인
npm run build -w @wonseoro/server-kit && npm run test:auth:verifier   # 검증기·JWKS 캐시, 발급자 정지 중 검증
npm run build -w @wonseoro/contracts -w @wonseoro/server-kit -w @wonseoro/admission-api && npm run test:auth:api   # 대학 API(oidc) 끝에서 끝까지 — CI 재현 DB(:5499) 필요
npm run build -w @wonseoro/central-api && npm run test:auth:central   # 중앙+대학(oidc) — 같은 토큰으로 공통원서 Snapshot 이 이어지는지
```

| 렐름 | 발급자 | 무엇 |
|---|---|---|
| `wonseoro-staff` | `http://localhost:18080/realms/wonseoro-staff` | 대학 담당자. 비밀번호 + TOTP 필수(인증 수준 `acr=mfa`), 5분이 지나면 TOTP 를 다시 묻는다. 역할 6종(`roles` 클레임). 클라이언트 `admin-web`(콘솔, 기밀 + PKCE) |
| `wonseoro-applicant` | `http://localhost:18080/realms/wonseoro-applicant` | 지원자 본인확인 흉내(실 간편인증·PASS 는 외부 기관). 역할 없음. 클라이언트 `applicant-web`(공개 + PKCE), 갱신 토큰 회전 |

**시험 계정** — 비밀번호·TOTP 비밀은 렐름 파일에 있는 **로컬 전용 시험값**이다. 시험 스크립트도 렐름 파일에서 읽는다.

| 계정 | 역할 | 비고 |
|---|---|---|
| `admin-a`, `admin-b` | admission-admin | 2인 승인 시험용으로 둘 |
| `auditor` | security-auditor | |
| `viewer` | platform-viewer | 틀린 OTP 시험에 쓴다(잠금이 다른 시험을 막지 않게) |
| `sre` | sre-operator | |
| `release` | release-controller | |
| `breakglass` | break-glass | **비활성** — 평시 로그인 불가(노션 06). 켜는 절차·경보는 T-M5-03 |
| `applicant-1`, `applicant-2` | (지원자) | |

TOTP 를 인증 앱에 넣으려면 렐름 파일 `secretData.value` 글자를 base32 로 바꿔 넣는다(Keycloak 이 그 글자 바이트를 키로 쓴다).
시험은 `tests/auth/helpers/totp.mjs` 로 계산한다. 같은 30초 창의 코드는 두 번 받지 않는다(재사용 방지).

운영과 다른 점 — 이 렐름 파일을 운영에 쓰지 않는다.

- 시험용 직접 발급 클라이언트 `wonseoro-dev-cli`(비밀번호 직접 교환)가 있다. 운영 렐름에는 두지 않는다
- 기밀 클라이언트 비밀·관리자 계정이 파일에 있다
- `start-dev`(내장 DB·HTTP). 운영 발급자는 HTTPS·외부 DB·HSM/KMS 키 보관(노션 06 Secret)
- 운영 API 는 `http:`·`localhost` 발급자를 거부한다(A12, 단계 3 에서 기동 검사)
