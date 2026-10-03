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
| T-M5-03 | break-glass 역할(Role 만, 평소 바인딩 없음, 켤 때 끝나는 시각·사유 필수 — D-68) | 끝나는 시각에 회수, 켜는 즉시 경보, DB 슈퍼유저 비상 접속 기록 — **단계 5 ✅(D-72)** |
| T-M5-04 | 노션 첨부 `vault-policy.hcl`(대학별 경로) | Vault 자체·DB 동적 자격증명·짧은 인증서. 지금은 Kubernetes Secret 하나(`runtimeSecret`) — **단계 4 ✅(D-71)** |
| T-M5-05 | 계약에 mutualTLS | **구현 없음 — 중앙 내부 경로·대학 API 내부 경로가 인증 없이 열려 있다(D-69)** |
| T-M5-06 | 컬럼 이름만(`pii_ciphertext`·`key_version='plaintext-dev'`) | 중앙 공통원서 금고·대학 원서의 고위험 필드가 평문 jsonb — **단계 3 ✅ 봉투 암호화(D-70)** |
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
  - `npm run test:security:mtls` — 실제 TLS 로 25개(인증서 없음·다른 CA 401, 다른 대학 사칭·다른 워크로드 403, 남의 영수증 404, 서류 검사 경로 보호, 실제 Relay 심장박동). CI 보안 시험 잡에서도 돈다(원격 Security run 37110144806 통과).
    CI 의 OpenSSL 3.0 은 시간 단위 유효기간을 몰라 개발 PKI 가 일 단위로 내려가게 했다
  - 단위: server-kit 8(신원 URI·실제 TLS·다른 CA·인증서 교체), 계약 대조(계약의 mutualTLS 경로 = 코드의 경로 표) 대학 2·중앙 2
  - 보안 선별 시험 194개(상호 TLS 묶음 12 추가) 건너뜀 0, admission-api 360·central-api 38·server-kit 87 통과
- **남은 것** — 계약 응답(401·403)·노션은 D-69. kind 실증과 인증서 자동 발급·교체는 단계 4(Vault PKI)

### 단계 2 ✅ (2026-10-03) — 출구 허용 목록(T-M5-07)·NetworkPolicy 자동 시험(T-M5-01)

- **`server-kit/src/egress.ts`** — 서비스마다 **자기 의존 서비스 URL 의 호스트만** 부른다(`configureEgress` — 대학 API: 중앙·로그인 서버 두 렐름·Object Storage,
  중앙: 로그인 서버, Relay: 중앙, 서류 워커: 자기 대학 API·Object Storage(가상 호스트 방식 `*.호스트` 포함), 더할 것은 `EGRESS_ALLOWLIST`).
  http·https 만. **연결 순간의 주소 검사** — DNS 가 무엇을 돌려주든 메타데이터(169.254.0.0/16·100.100.100.200·192.0.0.192·fd00:ec2::254)·
  미지정·멀티캐스트·링크 로컬은 연결하지 않는다(DNS 재바인딩, IPv4 를 품은 IPv6 도). 운영은 루프백도. 사설 대역은 클러스터 안 의존 서비스라 막지 않는다 — 이름 목록이 좁힌다.
  거절은 지표 `egress_denied{reason}`·경고 로그
- **모든 서버 쪽 호출이 거친다** — 내부 호출 클라이언트(`internalHttp` — 상호 TLS), 플랫폼 밖 호출(`egressHttp` — 로그인 서버 공개키·Object Storage 서명 URL, 시스템 신뢰 저장소)
- **서류 워커의 서명 URL** — 접수 API 가 준 주소를 그대로 부르던 것이 SSRF 통로였다. 이제 Object Storage 호스트가 아니면 내려받지 않고
  **검사 오류(`DOWNLOAD_URL_NOT_ALLOWED`)** 로 남겨 사람이 본다(장애처럼 다시 시도하지 않는다). 차트가 워커에 `S3_ENDPOINT` 를 넘긴다(runtime 첨부 v1.5)
- **NetworkPolicy** — 차트가 출구 규칙에 전체 인터넷(0.0.0.0/0·::/0)·메타데이터 대역을 넣으면 렌더링을 거부한다
- **시험**
  - `npm run test:security:netpol`(kind 두 대학) — 워크로드 3종 × 목적지 12 = **72칸** 통과: 대학 API·Relay 는 PgBouncer·Redis·중앙·Object Storage 만,
    서류 워커는 자기 대학 API 만. 직접 DB 우회·다른 대학 DB·다른 대학 클러스터·인터넷·**메타데이터 주소**·쿠버네티스 API 는 막힘
  - 단위: 출구 정책 5(호스트·포트·와일드카드·사용자 정보로 호스트 속이기·스킴·메타데이터 숫자/IPv6 표기·DNS 재바인딩을 실제 연결로), 서류 워커 SSRF 1
  - 보안 선별 시험 **200개** 건너뜀 0, 상호 TLS 실증 25 그대로, admission-api 360·server-kit 92·document-service 9 통과

### 단계 3 ✅ (2026-10-03) — 필드 암호화 (T-M5-06, D-70)

- **`server-kit/src/field-crypto.ts`** — 봉투 암호화. 레코드마다 DEK(32바이트 난수), 값은 AES-256-GCM(형식 `0x01|iv|tag|암호문`), DEK 는 KEK 로 감싼다.
  연결 데이터로 묶는다 — DEK 는 `univ:<대학>:application:<원서>`(중앙은 `central:vault:profile:<가명 토큰>`), 값은 `<원서>:<항목 코드>`(중앙은 `profile:<가명 토큰>`).
  암호문을 다른 원서·항목·대학 DB 로 옮겨 붙이면 풀리지 않는다. KEK 는 `KekProvider` 모양(감싸기·풀기만, 키는 밖으로 안 나온다 — 단계 4 Vault Transit 이 그대로 들어온다).
  지금은 환경 키 묶음 `FIELD_KEK_KEYS=id=base64,…`(첫 번째가 현재) — 운영 필수, 저장소의 개발 KEK(`dev`)는 운영 기동 거부. 실패는 `FieldKeyUnavailable`·지표 `field_crypto_failures{reason}`
- **무엇을 암호화하나** — 대학 원서의 **항목 값 전부**(`application_field_value` — 공통원서 Snapshot·자기소개·성적 등), 중앙 공통원서 금고 전체.
  "고위험" 을 고르지 않는다 — 대학이 설정으로 항목을 더하므로 분류가 빠지는 순간 평문이 생긴다
- **대학** — 마이그레이션 `0003_field_encryption.sql`(`application_data_key`·`value_ciphertext`·`value_json` NULL 허용·한 행은 형식 하나만·감사 역할은 감싼 키를 못 읽음).
  원서마다 DEK 하나, 푼 DEK 는 5분 메모리(Vault 호출을 줄인다). 저장은 언제나 암호문, 0003 이전 평문 행은 읽고(지표 `field_plaintext_reads`) 다음 저장에서 지운다
- **중앙** — `0004_vault_encryption.sql`(`fields_ciphertext`·`wrapped_dek`·CHECK). 공통원서는 통째로 바꾸므로 저장마다 DEK 를 새로 만든다
- **닫힌 실패** — 키가 없거나 풀리지 않으면 재시도 안내(503). 빈 값·평문으로 대신하지 않는다(빈 공통원서는 대학에 "동의 없음" 으로 잘못 나간다)
- **운영 명령** `node dist/tools/field-keys.js status|encrypt-legacy|rewrap [KEK]`(대학·중앙 같은 이름) — 평문 행 수·KEK 별 DEK 수, 옛 평문 이전,
  KEK 교체(새 KEK 를 맨 앞에 더한 뒤 rewrap → 감싼 DEK 만 다시 감싼다, 값은 그대로 → 옛 KEK 를 뺀다)
- **시험**
  - 대학 실제 DB 5개(`field-cipher.integration.test`) — 행 전체를 글자로 떠도 평문 없음, 다른 항목으로 옮겨 붙이기 거절, KEK 교체 뒤 읽힘·rewrap 뒤 옛 KEK 없이 읽힘,
    KEK 없음 닫힌 실패, 옛 평문 행 이전. 중앙 통합 3개(평문 없음·지원자/대학엔 그대로, KEK 교체·503, 옛 평문 이전). server-kit 단위 4개(변조·옮겨 붙이기·다른 대학 범위)
  - `db:verify` 21번(형식 하나만·감사 역할 키 읽기 차단)
  - 보안 선별 시험 **212개**(필드 암호화 묶음 9 추가) 건너뜀 0, admission-api 365·central-api 41 통과
- **남은 것** — KEK 를 Vault Transit 으로(단계 4). 로컬 compose DB·kind 가 보는 DB 에 0003·0004 적용(`npm run db:migrate`·`db:migrate:central` 이 포함한다), 노션 §02(D-70)

### 단계 4 ✅ (2026-10-03) — Vault 대학별 경로·짧은 자격증명 (T-M5-04, D-71)

- **`server-kit/src/vault.ts`** — Vault 클라이언트(Kubernetes·AppRole·토큰 로그인, 토큰 수명 2/3 에 다시 로그인, 출구 허용 목록을 거침 — `VAULT_ADDR` 는 `configureEgress` 가 늘 허용)
  - **Transit KEK** `VaultTransitKeyRing` — 단계 3 의 `KekProvider` 그대로. 연결 데이터는 Transit `associated_data`, KEK ID 는 `pii-<대학>:v<버전>`. 키 정보 읽기 권한 없이 감쌀 때 돌아온 버전으로 현재 버전을 안다. `FIELD_KEK_PROVIDER=vault`·`VAULT_TRANSIT_KEY`
  - **DB 동적 자격증명** — `Db.startCredentialRotation` 이 `database/creds/<역할>` 로 계정을 받고 수명 2/3 마다 새 계정을 받는다. 새 계정으로 연결을 확인한 뒤 연결 풀을 바꾸고, 옛 풀은 빌려 간 연결이 돌아오는 대로 닫는다. `DATABASE_CREDENTIALS=vault`·`VAULT_DB_ROLE`, 지표 `db_credential_rotations`
  - **PKI** `VaultCertRenewer` — SAN URI 워크로드 인증서를 받아 MTLS 파일 셋을 바꿔 쓴다(임시 파일 → rename, 인증서를 마지막에). 단계 1 의 서버·클라이언트가 재기동 없이 다시 읽는다. `MTLS_ISSUER=vault`·`VAULT_PKI_ROLE`·`WORKLOAD_URI`·`VAULT_PKI_ALT_NAMES`
  - 네 서비스 main 이 맨 앞에서 `startVaultSecrets()` — 인증서를 먼저 받고, Transit 에 한 번 감싸 보아 정책·연결을 확인한다(안 되면 기동 실패)
- **정책** — 노션 첨부 `vault-policy.hcl` 을 대학마다 그대로 적용했다(실제 Vault 에서 정확한 경로가 와일드카드 deny 보다 앞서 의도대로 동작). **PKI 역할·정책은 워크로드마다로 좁혔다(D-71)** — 대학 단위 역할이면 서류 워커가 Relay 인증서를 받아 이벤트를 위조할 수 있다
- **개발 Vault** — compose 프로필 `vault`(1.21, 개발 모드), 구성 `node scripts/vault/dev-vault.mjs`(KV·Transit `pii-<대학>`·DB 역할·PKI 루트 CA·워크로드 PKI 역할·정책·AppRole, 중앙 `pii-central`·`kadmission-central-service`)
- **차트** — `vault.enabled`·`vault.addr`. 켜면 워크로드별 Kubernetes 역할 `<대학>-<워크로드>`, 투사 ServiceAccount 토큰(audience vault, 10분), 인증서 볼륨은 메모리 emptyDir(워크로드가 쓴다), API·Relay 는 DB 동적 계정, API 는 Transit KEK. 끄면 지금처럼 runtimeSecret·인증서 Secret. 기본은 끔(runtime 첨부 그대로)
- **시험** `npm run test:security:vault`(개발 Vault + CI 재현 DB, 약 1분 반) **22개** — CI 보안 시험 잡에 Vault 서비스 컨테이너로 붙였다
  - 대학 경계: UNIV-A 신원으로 UNIV-B 의 KV·DB 계정·Transit·PKI·중앙 Transit·관리 경로 403, 자기 역할로 남의 대학 SAN URI 400. 같은 대학 안: 서류 워커의 Relay 인증서 403·400, DB·KEK 403, Relay 의 KEK 403
  - Transit: 감싸기·풀기, 다른 원서의 연결 데이터 거절, UNIV-B 가 UNIV-A KEK 로 못 풂, 키를 돌리면 새 버전·옛 버전도 풀림, rewrap 뒤 최소 버전을 올리면 안 옮긴 것은 닫힌 실패
  - DB: 수명 20초 계정 — 40초 동안 계정 3개로 바뀌는 사이 쿼리 192회 실패 0, 교체를 걸친 트랜잭션은 같은 계정으로 끝까지, 수명 끝난 계정은 지워짐, 동적 계정은 `kadmission_app` 권한만(슈퍼유저·역할 생성 없음)
  - PKI: 30초짜리 인증서로 실제 상호 TLS, 다시 받은 인증서를 서버·클라이언트가 재기동 없이 씀
  - **대학 API 를 Vault 만으로 기동** — DB 동적 계정·Transit KEK 확인·PKI 인증서(HTTPS)로 준비됨
  - 이 시험에서 확인한 운영 조건: 수명이 끝난 DB 계정은 Vault 가 세션을 끊는다 → **트랜잭션이 쓸 수 있는 여유는 수명의 1/3**(운영 1시간 → 20분, 쿼리 시간 상한보다 훨씬 길다)
- **남은 것(운영 쪽)** — 운영 Vault·Kubernetes 인증 역할을 플랫폼 관리자가 둔다. PgBouncer 는 동적 계정을 그대로 넘기도록 `auth_query` 로 둔다(지금 차트 PgBouncer 는 고정 계정). NetworkPolicy 의 Vault 출구도 플랫폼 값으로 연다. 중앙 API 배포(차트 밖)에도 같은 환경변수를 쓴다(`pii-central`·`kadmission-central-service`). 노션 §06(D-71)

### 단계 5 ✅ (2026-10-03) — break-glass 회수·경보·DB 비상 접속 (T-M5-03, D-72)

- **차트 렌더링 조건** — 비상 역할 바인딩은 `rbac.breakGlass.expiresAt` 전에만 렌더링한다(렌더링 시점 기준). 지금부터 12시간 넘는 시각은 렌더링 거부.
  GitOps(Flux)가 다음 조정 때 바인딩을 지우고 되살리지 않는다
- **회수 CronJob** `templates/break-glass.yaml`(비상 그룹을 켰을 때만) — 매분 `files/break-glass-reaper.mjs`(node 표준 라이브러리, 이미지 `node:22-alpine` digest 고정)를 돌린다.
  켜져 있으면 Warning 이벤트 `BreakGlassActive` + 경보 웹훅(`alertWebhookUrl`, Alertmanager v2 형식, 선택) + 경고 로그, 끝나는 시각이 지났거나 시각을 읽을 수 없으면 바인딩을 지우고 `BreakGlassRevoked`.
  권한은 그 바인딩 하나(resourceNames) 읽기·지우기와 이벤트 쓰기뿐, NetworkPolicy 로 출구는 API 서버·DNS(·경보 웹훅)만
- **DB 비상 접속** — 마이그레이션 `0004_break_glass.sql`: 역할 `kadmission_break_glass`(업무 표 읽기·고치기, DDL·감사 기록 수정 불가), 기록 `break_glass_access`(추가만, 앱 권한 없음, 감사 역할 읽기).
  Vault `database/creds/break-glass-<대학>` — 비상 그룹 정책만, 15분(최대 1시간). 생성문이 `log_statement=all` 을 걸고 기록에 한 줄 남긴다. 수명이 끝나면 세션을 끊고 지운다
- **시험**
  - `npm run test:security:break-glass`(kind-univ-a, 약 3분) **9개** — 12시간 넘게 거부, 90초짜리로 켜기, 회수 작업 권한 최소(다른 바인딩·바인딩 만들기·Secret 불가),
    켜진 동안 비상 그룹 권한·경보 이벤트·경고 로그, **끝나는 시각 63초 뒤 예약된 회수 작업이 바인딩을 지움**, 회수 이벤트, 회수 뒤 비상 그룹 권한 없음, 다시 렌더링해도 바인딩 없음
  - `test:security:vault` 비상 DB 계정(대학 API·Relay 신원 403, 15분, 기록·문장 로그 설정, 읽기 됨·DDL·기록 지우기 안 됨) — Vault 실증 **23개**
  - `db:verify` 22번(기록 추가만·비상 역할 DDL·감사 수정 차단), 17번에 기록 표(앱 권한 없음)
- **남은 것(운영 쪽)** — 운영 경보 웹훅 주소·API 서버 대역(`apiServerEgress`)을 클러스터 값으로. DB 서버의 문장 로그를 로그 수집으로 보낸다. 노션 §06·§02(D-72)
