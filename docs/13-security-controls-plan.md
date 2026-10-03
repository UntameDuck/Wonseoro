# 보안 통제 — 상호 TLS·출구 허용 목록·필드 암호화·Vault·break-glass·실 바이러스 검사

> 기준일: 2026-10-03 · 대상 태스크: **T-M5-01**(Network Default Deny) · **T-M5-03**(break-glass) · **T-M5-04**(Vault/KMS 대학별 경로) ·
> **T-M5-05**(Service mTLS) · **T-M5-06**(필드 암호화) · **T-M5-07**(SSRF 출구 허용 목록) · **T-M5-08**(실 AV) · **T-M5-09**(BOLA)
>
> 설계 원본: 노션 [06. NetworkPolicy·RBAC·Vault](https://app.notion.com/p/3df75ab5debe81e0aab2e000ccdebba7)("Default Deny, Least Privilege,
> Workload Identity, Short-lived Credential"), [09. STRIDE](https://app.notion.com/p/3df75ab5debe81e4bff5f44e1e3112d4), v1.0 §7.1(내부 통신 평문 금지)·§8.3(필드 암호화).
> 계약: OpenAPI 의 내부 경로 6개는 `security: [{ mutualTLS: [] }]`.

## 1. 지금 상태 (2026-10-03 조사)

| 태스크 | 있는 것 | 없는 것 |
|---|---|---|
| T-M5-01 | 차트 NetworkPolicy — default deny, 허용 경로만(공개→API, 워커→API, API·Relay→PgBouncer·Redis·통제된 출구, DNS, 지표 수집). kind 실측(D-45, 2026-09-28): 자기 DB·Redis·중앙·MinIO 만, 다른 대학 DB·임의 외부 차단 | 다시 돌릴 수 있는 자동 시험. 클라우드 메타데이터 주소(169.254.169.254) 차단 확인 |
| T-M5-03 | break-glass 역할(Role 만, 평소 바인딩 없음, 켤 때 끝나는 시각·사유 필수 — D-68) | 끝나는 시각에 회수, 켜는 즉시 경보, DB 슈퍼유저 비상 접속 기록 |
| T-M5-04 | 노션 첨부 `vault-policy.hcl`(대학별 경로) | Vault 자체·DB 동적 자격증명·짧은 인증서. 지금은 Kubernetes Secret 하나(`runtimeSecret`) |
| T-M5-05 | 계약에 mutualTLS | **구현 없음 — 중앙 내부 경로·대학 API 내부 경로가 인증 없이 열려 있다(D-69)** |
| T-M5-06 | 컬럼 이름만(`pii_ciphertext`·`key_version='plaintext-dev'`) | 중앙 공통원서 금고·대학 원서의 고위험 필드가 평문 jsonb |
| T-M5-07 | 출구 NetworkPolicy(egress-gateway 하나로) | 앱 수준 허용 목록. 서류 워커는 API 가 준 내려받기 주소를 그대로 부른다 |
| T-M5-08 | magic-byte 검사, ClamAV(clamd INSTREAM) 어댑터·가짜 clamd 시험(D-58) | 실 clamd·서명 DB 로 확인, Zip Bomb·매크로 문서 판정 |
| T-M5-09 | 지원자 간 BOLA 시험(소유권 404, 보안 선별 시험), 렐름 섞임 거절 | **대학 간 — 중앙이 이벤트·스냅숏 요청의 대학 식별자를 보낸 쪽이 적은 대로 믿는다(D-69)** |

## 2. 결정

| # | 결정 | 이유 |
|---|---|---|
| B1 | **앱 수준 상호 TLS** — 서비스 메시를 두지 않는다. API·중앙이 HTTPS 로 듣고 클라이언트 인증서를 **요청**하되(TLS 단계에서 강제하지 않음) `/internal/**` 경로만 검증된 인증서를 요구한다 | 대학 → 중앙은 클러스터를 건넌다(메시가 닿지 않는다). kind 메모리. 공개 경로는 앞단(Edge)이 TLS 를 끝내고 다시 TLS 로 넘긴다 |
| B2 | **워크로드 신원 = 인증서 SAN URI** `spiffe://wonseoro/university/<대학ID>/<워크로드>`·`spiffe://wonseoro/central/<워크로드>` | 노션 06 "Workload Identity". 이름(CN)보다 URI 가 위조 여지가 적고 대학·워크로드를 함께 담는다 |
| B3 | **신원과 요청을 묶는다** — 중앙: 이벤트의 `kadmissionuniversity`·`source` 와 스냅숏 요청의 `universityId` 가 인증서의 대학과 같아야 한다(다르면 403, 지표). 대학 API: 서류 검사 경로는 같은 대학의 `document-service` 인증서만 | T-M5-09 "Cross-university 객체 접근 0" |
| B4 | 모드 `INTERNAL_AUTH=mtls|none`. **운영에서 none 이면 기동 거부**(개발 헤더·Mock 과 같은 규칙). none 은 개발 서버·단위 시험용 | 지금 시험·화면 캡처를 깨지 않고, 운영에 평문이 섞이지 않게 |
| B5 | 인증서는 짧게(24시간) 쓰고 **파일이 바뀌면 다시 읽는다**(재기동 없음). 처음은 개발 CA 스크립트(openssl), 단계 4 에서 Vault PKI 가 발급 | 노션 06 "Short-lived Credential" |
| B6 | 출구 허용 목록은 **앱과 네트워크 둘 다** — 앱의 내부 호출 클라이언트가 허용 호스트만 부르고 사설·메타데이터 주소를 거절, NetworkPolicy 는 메타데이터 주소를 막는다 | 하나만으로는 설정 실수 하나에 뚫린다 |
| B7 | 필드 암호화는 **봉투 암호화**(레코드마다 DEK, KEK 로 감싼다, AES-256-GCM, `key_version` 으로 교체). KEK 는 처음엔 파일 키, 단계 4 에서 Vault Transit | v1.0 §8.3 "KEK/DEK 분리" |

## 3. 순서

| 단계 | 내용 | 끝났다고 말할 근거 |
|---|---|---|
| 1 | 상호 TLS·대학 신원 묶기(T-M5-05·09) — `server-kit` mTLS(서버 옵션·인증서 다시 읽기·SAN 신원·클라이언트), 중앙 내부 경로·대학 서류 검사 경로 보호, Relay·서류 워커·대학 API 의 중앙 호출에 인증서 | 실제 TLS 로: 인증서 없음 401, 다른 대학 인증서로 남의 대학 이벤트·스냅숏 403, 같은 대학 202·200, 평문 거절. 다른 워크로드 인증서로 서류 검사 403 |
| 2 | 출구 허용 목록(T-M5-07)·NetworkPolicy 자동 시험(T-M5-01) | 허용 밖 호스트·사설·메타데이터 주소 거절 단위 시험, kind 에서 허용·차단 행렬 |
| 3 | 필드 암호화(T-M5-06) — 중앙 공통원서 금고, 대학 원서의 고위험 필드 | DB 에 평문 없음, 키 교체 뒤 옛 데이터 읽힘, 키 없으면 닫힌 실패 |
| 4 | Vault(T-M5-04) — 로컬 Vault, 대학별 경로, DB 동적 자격증명, PKI(단계 1 인증서), Transit(단계 3 KEK) | 다른 대학 경로 거절, 자격증명 만료 뒤 재발급으로 무중단 |
| 5 | break-glass 회수·경보(T-M5-03) | 끝나는 시각 지나면 바인딩 회수, 켜면 경보 |
| 6 | 실 바이러스 검사(T-M5-08) — clamd 이미지·서명 DB | EICAR·Zip Bomb·매크로 문서 판정 |

각 단계 끝에 보안 선별 시험·DAST 를 다시 돌리고, 계약·노션 차이는 대장(D-N)·[06 변경안](06-notion-changeset.md)에 올린다.

## 4. 진행

### 단계 1 ✅ (2026-10-03) — 상호 TLS·대학 신원 묶기 (T-M5-05·09, D-69)

- **`server-kit/src/mtls.ts`** — `INTERNAL_AUTH=mtls|none`(운영 none 기동 거부), 서버 옵션(클라이언트 인증서 요청·강제 안 함, TLS 1.2+),
  인증서 파일이 바뀌면 `setSecureContext` 로 교체(재기동 없음), 상대 인증서 → 워크로드 신원(SAN URI, 다른 CA·신원 없음·신원 둘 거절),
  내부 호출 클라이언트(`undici` 7.30.0 — 자기 인증서를 내고 상대를 플랫폼 CA 로 검증, 파일이 바뀌면 연결 풀 교체)
- **중앙 API** — HTTPS 로 듣는다. 경로 표 `INTERNAL_ROUTES`(이벤트·영수증 = 대학 Relay, 스냅숏 = 대학 API, 현황 = 중앙). 이벤트의 대학·출처, 스냅숏의 대학 =
  인증서의 대학(`sameUniversity`), 남의 영수증은 404. 판정 지표 `internal_auth_decisions`, 거절은 신원 URI 와 함께 경고 로그
- **대학 API** — HTTPS. 서류 검사 경로 둘은 같은 대학의 `document-service` 인증서만. 공통원서 스냅숏·중앙 상태 확인은 자기 인증서로
- **Relay·서류 워커** — 중앙·대학 API 내부 경로를 자기 인증서로 부른다
- **차트** — `internalTls`(워크로드별 Secret `<release>-<워크로드>-mtls` 의 tls.crt·tls.key·ca.crt, 환경변수, API HTTPS 프로브·서비스 443, 서류 워커 → API https).
  운영(`global.environment=production`)은 끌 수 없다(렌더링 거부). 로컬 kind 는 단계 4(Vault PKI)까지 끈다. runtime 첨부 v1.4
- **개발 PKI** `scripts/pki/dev-pki.mjs`(openssl — 플랫폼 CA·워크로드 인증서 24시간·거절 시험용 다른 CA)
- **시험**
  - `npm run test:security:mtls` — 실제 TLS 로 25개(인증서 없음·다른 CA 401, 다른 대학 사칭·다른 워크로드 403, 남의 영수증 404, 서류 검사 경로 보호, 실제 Relay 심장박동). CI 보안 시험 잡에서도 돈다
  - 단위: server-kit 8(신원 URI·실제 TLS·다른 CA·인증서 교체), 계약 대조(계약의 mutualTLS 경로 = 코드의 경로 표) 대학 2·중앙 2
  - 보안 선별 시험 194개(상호 TLS 묶음 12 추가) 건너뜀 0, admission-api 360·central-api 38·server-kit 87 통과
- **남은 것** — 계약 응답(401·403)·노션은 D-69. kind 실증과 인증서 자동 발급·교체는 단계 4(Vault PKI)
