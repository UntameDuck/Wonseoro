# Pilot 지원 도구 구현·인계

> 최종 갱신: 2026-10-04 · T-M6-01·06·07 모두 완료 — Pilot 지원 도구의 AI 몫 끝

T-M6-01·06 은 커밋 `38b97dd`·`2531e4a`, T-M6-07 은 커밋 `314fb62` 다. 임시 웹/API 프로세스는 모두 종료했다. 화면 시험용 PostgreSQL 컨테이너 `ui-shots-pg`(:5497)와 CI 재현 DB `ci-pg`(:5499)는 실행 중일 수 있고, 둘 다 대학 마이그레이션 0001~0008 이 적용돼 있다.

## T-M6-01 전형 Schema 온보딩 — 완료

- 관리자 설정 화면에서 빈 Config 또는 적용 중 Config로 시작해 전형·문항·공통원서 연결·제출 서류를 구조적으로 편집한다.
- 구조화 편집기는 기존 고급 JSON과 같은 Config를 만들며, 알 수 없는 기존 키를 보존한다. 고급 JSON 편집 경로도 그대로 남겼다.
- 화면 선검사 뒤 기존 서버 Config Linter, 2인 승인, T-M6-02 호환 시험으로 이어진다.
- 주요 파일: `apps/admin-web/src/components/config-onboarding.tsx`, `apps/admin-web/src/lib/config-onboarding.ts`, `apps/admin-web/src/app/api/public/admission-types/route.ts`.
- 검증: 관리자 운영 빌드, 화면 문구 검사, Chrome 1280/320 각 9화면·Tab 153/157자리·문제 0.

## T-M6-06 상태 페이지·대학별 장애 배너 — 완료

설계 결정은 [D-78](02-spec-discrepancy-register.md)에 있다. 공지는 중앙이 아니라 각 대학 Data Plane이 소유한다. 중앙 장애와 별개로 대학 API가 살아 있는 동안 상태 안내가 유지되고, 공개 응답에는 지원자 안내만 담는다.

- 저장: `infra/db/migrations/0007_service_incident.sql`. 추가 전용 원장이고 `ACTIVE → RESOLVED`만 허용한다. 삭제·본문 수정 권한은 없다. Writer fence도 적용한다.
- 공개 API: `GET /api/v1/meta/service-status`.
- 운영 API: `GET/POST /admin/v1/incidents`, `POST /admin/v1/incidents/{incidentId}/resolve`. operator 범위, Step-up, 멱등 키, 감사 이벤트가 필요하다.
- 지원자 화면: 전역 배너와 `/status`. 30초마다 대학 상태를 갱신한다.
- 관리자 화면: `/status`에서 공지 발행·목록·해제.
- 계약: OpenAPI 1.8.0, 감사 동작 `INCIDENT_PUBLISHED`·`INCIDENT_RESOLVED`.

확인한 결과:

- DB 마이그레이션 적용 및 제약·권한 검증 22종 PASS.
- incident 통합 시험 2/2 PASS.
- admission-api 전체 382개: 379 pass, 3 skip, 0 fail.
- admin-web·frontend 운영 빌드 PASS, `npm run check:contracts` PASS(1.8.0, 58 operations), `npm run check:ui-copy` PASS(187 files).
- 상태 화면 접근성: Chrome 1280/320 각각 2화면·Tab 19자리·문제 0.
- 관리자 전체 접근성: Chrome 1280/320 각각 10화면·Tab 176/180자리·문제 0.
- 브라우저에서 발행 → 전역 배너/상태 페이지 → 해제 → 정상 복귀를 확인했고, 활성 시험 공지는 남기지 않았다.

결과 파일은 `tests/a11y/results/`의 다음 네 파일이다.

- `focus-sweep-status-chrome-1280-2026-10-03T15-12-50-355Z.json`
- `focus-sweep-status-chrome-320-2026-10-03T15-13-02-841Z.json`
- `focus-sweep-admin-chrome-1280-2026-10-03T15-13-20-868Z.json`
- `focus-sweep-admin-chrome-320-2026-10-03T15-14-07-087Z.json`

## T-M6-07 PII 최소 Support View — 완료

설계 결정은 [D-79](02-spec-discrepancy-register.md)에 있다. 노션 B11 은 "자동 증적번호, PII 최소 Support View" 두 단어뿐이라 역할·조회 키·응답 범위·증적 형식을 새로 정했다.

- **역할** — 담당자 렐름에 `support-agent`(상담 담당)를 더하고 계약 범위 `support` 를 둔다. `support-agent`·`admission-admin` 이 연다. 비밀번호+OTP 로그인(`acr=mfa`)은 요구하고 Step-up 은 두지 않는다(장애 중 상담은 몇 분마다 이어진다). 시험 계정 `support`(`infra/auth/README.md`). Kubernetes 권한·차트 변경 없음.
- **조회 키** — 접수번호, 또는 **상담 확인번호**(`application.support_code`, Crockford base32 10자, DB 기본값으로 모든 원서에 생김, 바꿀 수 없음). 지원자는 검토·결제 단계, 접수 완료, 장애 안내 화면에서 `XXXXX-XXXXX` 로 본다(Self-check `supportCode`). 이름·연락처·원서 UUID 로는 찾지 않는다. 없는 번호는 두 키 모두 같은 404.
- **응답** — 허용 목록(`SupportView`)으로만 만든다: 증적번호·조회 시각·대학/모집 이름·원서 상태와 한 줄 안내·접수 여부/접수번호/시각·결제 상태/금액/요청·확인 시각·서류 상태별 개수·중앙 반영·처리 이력(행위자 없음)·마감·활성 장애 공지·상담 안내 문장. 지원자 Self-check 와 같은 문장을 쓰도록 `modules/meta/status-summary.ts` 로 모았다.
- **자동 증적번호** — 조회마다 `SR-YYYYMMDD-XXXXXX`(한국 날짜). 그 순간 응답 전체와 SHA-256 을 추가 전용 `support_lookup` 에 남기고, 같은 트랜잭션에서 원서 감사 체인에 `SUPPORT_LOOKUP` 을 잇는다(지원자 처리 이력에 "상담 조회"). `GET …/{증적번호}` 는 그때 내용을 그대로 열고 해시로 무결성을 보인다.
- 저장: `infra/db/migrations/0008_support_view.sql`(적용 목록 9곳 모두 갱신 — CI·보안·복구 검증 워크플로, `db:migrate`, 캡처·DAST 스크립트, kind README, `infra/db/README.md`).
- API: `POST /admin/v1/support/lookups`(멱등 키, 문의 분류 필수 — 자유 문장 없음), `GET /admin/v1/support/lookups/{evidenceNumber}`. OpenAPI **1.9.0**.
- 화면: 운영 콘솔 `/support`(조회·증적번호로 다시 보기, 메뉴와 첫 화면 목록에 추가).

확인한 결과:

- DB 제약 검증 **23종** PASS(23: 상담 확인번호 고정·형식, 상담 증적 추가만, 앱 역할 삭제 불가. 17 의 표별 권한 규칙에 `support_lookup` 추가).
- `support.integration.test` 6개(응답 키 전수가 허용 목록 안, 원서/결제 식별자·파일 이름·서류 종류·전형/모집단위 값 없음, 증적·해시·감사 체인, 다시 열기 일치, 저장본 수정·삭제 거부, 없는 번호·다른 대학 번호·원서 UUID 같은 404, 자유 문장 사유 400). 보안 선별 시험(`test:security`) 묶음에 넣었다.
- 역할 표: guard 단위 시험 7역할 × 4범위, 실 HTTP `oidc-auth.integration` 7역할 × 5경로(상담 담당은 상담만 열림).
- admission-api 전체(CI 재현 DB): **388개 중 385 pass · 3 skip · 0 fail**. `check:contracts`(1.9.0, 60 operations)·`check:ui-copy`(193 files)·`check-deps`·`check-logging`·`git diff --check` PASS. admin-web·frontend 운영 빌드 PASS.
- 접근성: 관리자 Chrome 1280/320 각 13화면(상담 조회 빈 화면·결과·증적번호로 다시 보기 포함) 문제 0, 지원자 Chrome 1280/320 각 20화면 문제 0. 처음 실행에서 빈 선택지가 있는 필수 select 가 처음부터 "올바르지 않음" 으로 읽혀 필수 속성을 빼고 버튼으로 막았다.
- 결과 파일: `tests/a11y/results/focus-sweep-admin-chrome-1280-2026-10-04T01-42-57-698Z.json`, `…-admin-chrome-320-2026-10-04T01-41-52-305Z.json`, `…-applicant-chrome-1280-2026-10-04T01-48-57-164Z.json`, `…-applicant-chrome-320-2026-10-04T01-50-12-730Z.json`.

남은 것(선택·외부):

- 접수번호로 증적 패키지를 찾는 U-51 은 여전히 선택이다(감사자 화면).
- 실제 Keycloak 로 `support` 계정 로그인 끝에서 끝까지는 돌리지 않았다 — 렐름 파일만 고쳤으므로 Keycloak 을 `up -d --force-recreate keycloak` 으로 다시 띄워야 계정이 생긴다. 역할 판정은 HTTP 시험(서명한 시험 토큰)으로 확인했다.
- 노션 반영(§01 B11·§02 ERD·§03 첨부·§06 역할) — [06](06-notion-changeset.md).

## 재검증 명령

PowerShell에서 저장소 루트 기준:

```powershell
npm run check:contracts
npm run check:ui-copy
npm --workspace apps/admission-api run typecheck
npm --workspace apps/admin-web run build
npm --workspace apps/frontend run build
git diff --check
```

DB 포함 admission-api 전체 시험은 기존 `ui-shots-pg` 또는 CI 재현 DB의 접속 환경을 맞춘 뒤 실행한다. 컨테이너와 포트 운용법은 [HANDOFF](HANDOFF.md)와 `scripts/screenshots/prepare.sh`를 따른다. 기존 미추적 결과 파일과 `tests/ops/`는 다른 작업 흔적일 수 있으므로 정리하거나 커밋에 섞기 전에 반드시 `git status`로 소유 범위를 확인한다.
