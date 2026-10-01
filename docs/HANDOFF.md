# 인수인계 — 다음 작업자(사람·AI 공통)가 먼저 읽는 문서

> 작성: 2026-09-29 · 마지막 커밋 기준 `main`
> 이 저장소는 지금까지 한 AI 도구로 개발했다. 다른 도구(또는 사람)가 이어받을 때
> **도구 설정 파일에만 있던 규칙**과 **문서 여러 곳에 흩어진 다음 할 일**을 여기 한 장에 모았다.
> 세부는 링크를 따라간다. 이 문서와 다른 문서가 어긋나면 **다른 문서가 맞고, 이 문서를 고친다.**

---

## 1. 30초 요약

- **제품**: 원서로(K-Admission) — 대학 입학 원서접수를 대학별 Data Plane 으로 분산하는 플랫폼. 2026 GovTech 공모전 출품작
- **현재**: M0~M3 끝(MVP가 화면에서 접수번호까지 동작), **M4(분산 실증) 20/28 진행 중**. 전체 **99/146** 태스크(✅ 만 셈, 2026-10-02 보안 파이프라인 7개 완료). **CI 네 잡과 Security 열 잡 모두 초록**(Actions run 36898651960·36898652054)
- **완료한 핵심 증명**: 로컬 kind 2클러스터 축소 환경에서 **대학 간 장애 격리 T-M4-42 통과**. A대 전면 정지 중 B대 접수·중앙 반영, A대 복구 후 접수까지 확인
- **최근 완료**: T-M4-07 Peak Mode(ADR-0006) · T-M4-20 전 서비스 계측·로그 상관관계 · T-M4-24 로그 마스킹 강제 · **T-M4-21~23 업무 KPI·대시보드 3종** · **D-50 취소 이벤트 계약 위반 수정** · CI 복구 · **T-M4-40 NAT Adaptive Throttling(ADR-0007)** · 과부하 중 API 프로세스가 죽던 결함 수정 · **T-M4-37 Redis 장애 무영향** · T-M4-39 다중 노드 시험(drain 무중단·노드 장애 때 전체가 멈추던 DB 연결 결함 수정, D-52) · **맡겨진 결정 정리(2026-09-30)** — D-44 ⑦(Pod 당 38)·D-47·D-51(OpenAPI v1.3.0 429)·D-52(ADR-0008)·D-53(ingress-nginx 은퇴) 결정·저장소 반영. §05 runtime 첨부를 차트 렌더링으로 바꿔 CI 가 드리프트를 막는다. **노션 반영은 AI 쓰기가 막혀 [06-notion-changeset.md](06-notion-changeset.md) 로 대기**
- **T-M4-35 ✅** 중앙 2시간 실제 단절 통과 — 원서 24건 처리·DEAD 0·event loss 0·복구 10초 뒤 전량 전송·재시작 0 (`central-outage-realtime-2026-09-30T01-59-27-784Z.json`)
- **미완결 기능 전수 점검 ✅ (2026-09-30, D-55 ~ D-61)** — 정의만 있고 흐름에 이어지지 않던 것·흉내뿐이던 것을 모두 잇거나 이유와 함께 남겼다: 원서 상태머신·한 원서 한 결제·PG 정산 대조, §A9 시각(노드–DB offset·DB 커밋 시각), 공통원서 지원자 API·화면, 설정 기반 서류·항목·Config Linter, §04 심장박동, ClamAV 어댑터, 운영 콘솔 초안·보존기간, 계약 검사 스크립트. OpenAPI **v1.4.0**. 정리표는 [04-production-readiness.md §7](04-production-readiness.md#7-흉내미연결-전수-점검-2026-09-30). **kind 에는 아직 이 코드의 이미지를 올리지 않았다** — 다음 kind 작업 때 이미지 재빌드·`seed-dev.sql` 재적용
- **화면 캡처 27장 (2026-09-30)** — 지원자 웹 19장(정상 흐름·검증 오류·취소·중앙/대학 장애)과 관리자 콘솔 8장을 [docs/screenshots/](screenshots/README.md)에 두었다. 전용 DB(`ui-shots-pg` :5497)와 전용 포트로 찍어 kind 시험과 섞이지 않는다. 다시 찍는 스크립트는 `scripts/screenshots/`. 찍으며 **화면 결함 U-1~U-11** 을 찾았다(검증 오류가 영문 원문, 접수증에 전형·모집단위 없음 등). 고치지 않고 README 에 적어 두었다
- **T-M4-34 ✅** PG 확정 1~30분 지연 실제 시간 — 8건 모두 자동 접수, 콜백 경로 4.7~7.9초·폴링 경로 49.9~171.3초. 이 시험에서 **리더 잠금이 PgBouncer 에서 새어 워커가 주기를 건너뛰던 결함(D-54)** 을 고쳤다
- **T-M4-39 재측정 🟡** drain·정비 뒤 재분산 무중단, 노드 강제 정지 첫 시도 6.1%·체감 1.4%(Edge 재시도 대상 — K-PaaS 판정). zone 분산 Honor·matchLabelKeys·PgBouncer 정상 종료·연결 사용 횟수 돌리기, 측정 도구 결함 둘 수정(ADR-0008)
- **화면 제품화 목표 추가 (2026-10-01, 문서만)** — 화면에 섞인 "개발자가 개발자에게 하는 말"을 전수 점검해 **U-1 ~ U-59**·결정 16개·회귀 방지 검사로 정리했다 → [08-ui-production-readiness.md](08-ui-production-readiness.md). 대상은 설계 설명·설계 문서 번호·내부 코드·개발용 입력·영문 오류다. 태스크 **T-M5-50~56**. 디자인은 바꾸지 않는다. 같은 점검에서 **증적의 감사 체인이 정상 원서를 "끊김"으로 판정하는 결함 D-62** 를 찾았다(원서 체인에 시각 단조·잠금 없음)
- **D-62 ✅ 수정 (2026-10-01)** — 재현 시험 3개(offset 역전·같은 원서 동시 기록·옛 기록 판정, 고치기 전 코드에서 모두 실패) → 원서 행 잠금(`FOR NO KEY UPDATE`, 교착 방지)·직전보다 뒤 시각·연결 끝 조회, 검증은 앞 해시 연결을 따라간다. admission-api 315개 통과
- **T-M5-53 ✅ (2026-10-01)** 개발용 본인 확인·담당자 입력을 개발 서버(`next dev`)에 가뒀다. 운영 빌드에는 입력칸·시드 값이 없고, 켜서 빌드하면 멈춘다. 운영 콘솔은 담당자 쿠키를 무시하고 지정을 403 으로 거절한다. 캡처 스크립트는 `next dev` 라 그대로 쓴다. 운영 빌드 화면을 볼 때는 미리보기 `shots-web-prod`(빌드 먼저)
- **T-M5-50 ✅ (2026-10-01)** 화면의 설계·구조 설명과 설계 문서 번호를 걷어냈다(접수 홈 "이 서비스의 구조", 바닥글 "원본은 대학 서버", 보존기간 근거의 `v1.0 §9`·`(D-35)`, "개발용 환경변수 정책" 등). 콘솔 첫 화면은 "지금 처리할 일" 로 바꿨다. **소스 문구 검사 `npm run check:ui-copy`** 가 CI 에 붙었다 — 화면 문자열에 설계 번호·개발 안내를 넣으면 CI 가 깨진다(근거는 주석에)
- **T-M5-51 ✅ (2026-10-01)** 화면의 내부 코드·식별자·버전을 사람 말로 바꿨다 — 사람 말 사전 `packages/contracts/src/labels.ts`, **OpenAPI 1.5.0·CloudEvents 표시 이름 선택 필드**(노션 첨부 교체 대기, 06), **중앙 마이그레이션 `infra/db/central/0003_summary_names.sql`**(로컬 중앙 DB·`ka-central` 에 새 이미지를 올리기 전에 적용 — `npm run db:migrate:central`), 이름 없는 양식 항목은 설정 초안 거절, Diff 요약은 전형·항목 이름. 축소 환경 전체 흐름에서 D-62 수정도 확인(정상 원서 감사 체인 9건 끊김 없음)
- **T-M5-52 ✅ (2026-10-01)** 검증 오류는 서버가 항목 이름으로 만든 한국어 문장, 오류 요약 항목을 누르면 그 칸으로 간다(칸 옆에도 같은 오류, 고치면 바로 지움). 화면은 서버 오류 문구 대신 오류 code 의 문구(`packages/contracts/src/problem-text.ts`)를 보인다. 문구 검사가 서버 오류 문장(ProblemException 인자·title·detail)의 코드 식별자·헤더 이름·상태 코드도 막는다
- **T-M5-54 ✅ (2026-10-01)** 날짜·시각 표기를 KRDS 한 곳(`packages/krds/src/format.ts`, 와이어프레임 "2026.12.31 18:00", 언제나 한국 시간)으로 모았다. 마감 배너에 날짜, 모집 제목 학년도 중복 제거, 콘솔 마감 입력은 한국 시간 고정. 이모지·기호 아이콘 23곳을 SVG(`icon.tsx`)로 — 문구 검사가 기호를 막는다. 표기 시험은 CI 에서 다른 시간대로 돈다
- **T-M5-55 ✅ (2026-10-01)** 장애 안내가 마지막 저장·서버 상태·요청번호를 언제나 채운다 — **요청번호는 화면이 `traceparent` 로 만들어 보낸다**(서버 traceId·로그와 같은 번호, 연결이 끊겨도 남는다). 10초 넘는 요청 안내, 내 원서 본인확인 전·연결 실패·그 밖의 오류 구분, 콘솔 불러오는 중/없음 구분, 화면마다 제목, 한국어 404·오류 화면·앱 아이콘, 접수증 인쇄 스타일
- **T-M5-56 ✅ — 화면 제품화 끝 (2026-10-01)** 단계 표시 ✓ 는 검증된 단계에만, 결제 전 확인 체크·결제 요청 시각, 접수증 전형·모집단위·상태(**계약 1.6.0**), 서류 형식·크기 안내(서버와 같은 출처)·검사 결과 자동 갱신, 선택 목록 항목, 머리글·경로에 대학·모집 이름. **화면 27장을 다시 찍었다 — 렌더링 문구 검사(`capture.mjs --check-copy`) 모두 통과**. 캡처 준비 중 **D-63**(빌린 DB 연결이 끊기면 프로세스가 죽음)을 찾아 고쳤다 — DB 재시작·장애 전환에 서비스가 같이 죽지 않는다
- **접근성 T-M5-40~46 ✅·47 🟡 (2026-10-01)** — [09-accessibility.md](09-accessibility.md). 시험 `tests/a11y/`(설치 없이 Chrome·Edge 를 DevTools 프로토콜로 — 키보드 완주·전 화면 포커스·스크린리더 재료·200%·320px·세션 만료·한도 해제·휴대전화 터치). 고친 것: 화면 전환 뒤 포커스 유실(단계 제목·오류 요약·결과 안내로), **마감 카운트다운을 매초 읽던 알림 영역**, 필수 표시 이중 낭독, 늘 있는 안내 상자까지 알림 영역이던 것(`LiveRegion` 으로 정리), 큰 제목 없는 화면, 콘솔 표의 320 가로 스크롤(`TableScroll`), 24px 미만 누르는 대상. **새로 둔 것**: 지원자 세션 만료(무활동 30분·5분 전 경고·경고/만료 순간 즉시 저장 — `lib/session.ts` 한 곳, 본인확인이 붙으면 거기만 바꾼다), 429 한도 안내(`RateLimitNotice` — 전에는 화면 전체를 장애 안내로 바꾸며 "자동으로 다시 시도" 라고 했지만 다시 보내지 않았다), **퍼즐형 CAPTCHA 를 두지 않는다(ADR-0009)**, 지원 브라우저 `browserslist`(Chrome·Edge 92+·Firefox 98+·Safari 15.4+). 47 의 실물 Firefox·Safari 는 사람(또는 시험용 브라우저 내려받기 승인)
- **보안 파이프라인 T-M5-20~23 ✅ (2026-10-02)** — `.github/workflows/security.yml`의 세 병렬 잡이 원격에서 통과했다(Actions run 36887597976). Gitleaks 8.30.1 전체 이력 실제 비밀 0건, CodeQL `security-extended` Critical 0, 운영 의존성 Critical 0·High 2·Moderate 2, SPDX 2.3 SBOM 패키지 266개·관계 1,054개. NestJS 10→11로 기존 Critical을 없앴다. 시험 값 오탐 39건은 `.gitleaks.toml`에서 값 형식만 좁게 제외했다. SBOM은 일반 CI 산출물과 `release.published` 릴리스 자산을 모두 만든다
- **T-M5-24·25 ✅ (2026-10-02)** — Trivy 0.75.0으로 서비스 4종·PgBouncer 실제 이미지 Critical 0, Helm·Kubernetes·Dockerfile 설정 파일 19개 High/Critical 0을 로컬과 원격 matrix에서 확인했다(Actions run 36890582638). `KSV-0056`은 namespace 한정 release-controller의 서명된 Helm 동기화에 필요한 권한만 파일 네 곳·2027-01-31 만료로 허용했다. 세부는 [11-security-pipeline.md](11-security-pipeline.md)
- **T-M5-26 ✅ (2026-10-02)** — 실 PostgreSQL의 대학·중앙 DB를 사용해 권한·감사 체인·결제 콜백·입력 방어·재전송·개인정보 최소화 등 선별 보안 시험 123개를 별도 게이트로 실행한다. 로컬·원격 123개 통과·건너뜀 0이다(Actions run 36898652054). DB 미연결로 통합시험이 skip되어도 게이트가 실패한다
- **T-M5-27 착수 (2026-10-02, 🟡)** — ZAP 2.17.0 고정 digest로 OpenAPI 81개 URL을 실제 대학 API·PostgreSQL에 active scan했다. 첫 실행에서 잘못된 `cycleId`·`limit`가 DB까지 내려가 500이 되는 문제, `/meta/time` 무인자 500, `nosniff` 누락을 찾아 고쳤다. 같은 조건 재실행은 **WARN 0·High 0·PASS 118**, 보고서는 `E:\DockerData\tools\zap-2.17.0\reports`에 있다. 원격 확인 전이다
- **바로 다음 할 일**: T-M5-27 원격 통과 확인 → **T-M5-28·29**(이미지 서명·Admission Controller) → 인증(로컬 OIDC — 세션 만료·위험 차단 해제도 함께, ADR-0009) → 보안 통제 → …

## 2. 반드시 지킬 규칙

| # | 규칙 | 근거 |
|---|---|---|
| R1 | **문서·커밋·보고는 한국어.** 코드 식별자·명령만 원문 | 저장소 전체가 한국어 |
| R2 | 커밋 메시지 형식: `feat: …` / `fix: …` / `docs: …` + 빈 줄 + `- ` 목록. **AI 공동저자(Co-Authored-By) 줄을 넣지 않는다** | `git log` 참고 |
| R3 | 브랜치: 지금까지 `main` 에 바로 커밋했다 (2인 팀 관행) | |
| R4 | **노션 기술설계서가 설계의 원본이다.** 설계와 다른 구현을 발견하면 조용히 고치지 말고 먼저 [불일치 대장](02-spec-discrepancy-register.md)에 `D-N` 으로 올린다 | [01-notion-sync-protocol.md](01-notion-sync-protocol.md) |
| R5 | **노션 첨부(DDL·OpenAPI·CloudEvents·Helm values 등)는 저장소 사본과 바이트가 같아야 한다.** 첨부 원본 파일(`deploy/charts/k-admission/values-m.yaml`, `deploy/platform/policies/*`, `tests/load/k6-admission.js`, `docs/spec-assets/*`)은 **고치지 않는다** — 다르게 해야 하면 대장에 올리고 차트·코드 쪽에서 다루거나, 노션 첨부를 교체한다. **계약 파일(DDL `0001_init.sql`·OpenAPI yaml·CloudEvents json)은 고칠 수 있지만, 고치면 같은 작업에서 노션 첨부도 다시 올린다**(지금까지 그렇게 했다). ⚠️ **2026-09-30 부터 첨부 5종(OpenAPI·CloudEvents·values-m·runtime·와이어프레임)은 저장소가 앞선다** — AI 의 노션 쓰기가 권한 분류기에 막혔다. 올릴 파일·해시는 [06-notion-changeset.md](06-notion-changeset.md). **runtime 첨부는 손으로 고치지 않는다** — 차트·values-m 을 고치고 `node scripts/render-runtime-attachment.mjs` | [spec-assets/README.md](spec-assets/README.md) | [spec-assets/README.md](spec-assets/README.md) |
| R6 | **노션 페이지 수정은 페이지마다 사용자에게 확인받고 한다** | [05 문서 ③-7](05-m3-exit-m4-readiness.md) |
| R7 | 수치를 지어내지 않는다. 로컬(kind) 결과는 **"축소 환경"** 으로 명시하고, SLO·부하 수치는 K-PaaS 실측 전까지 "목표값" 이다 | [05 문서 ④](05-m3-exit-m4-readiness.md) |
| R8 | 흉내 구현(Mock PG·Mock AV·헤더 인증)은 **운영 모드(`NODE_ENV=production`)에서 기동이 막힌다.** 이 안전장치를 풀지 않는다 | [04-production-readiness.md](04-production-readiness.md) |
| R9 | 마감시각·전형료·전형 양식(Config) 버전은 **배포 값으로 넣지 않는다.** 관리자 콘솔의 2인 승인 → 서명된 활성화 기록으로만 바뀐다 | D-21 · D-35 · D-44 ⑥ |
| R10 | 새 지원자 API 경로는 소유권 검사(`this.ownership.assert…`)를 부른다. 빠뜨리면 `ownership-coverage.test.ts` 가 깨진다 | D-28 |

## 3. 환경 — 이 PC(Windows 11)에서 알아야 할 것

| 항목 | 내용 |
|---|---|
| 셸 | Git Bash 에서 `docker run -v/--tmpfs /tmp` 처럼 `/` 로 시작하는 인자는 경로 변환된다 → `export MSYS_NO_PATHCONV=1` |
| 도구 | kind 0.33 · Helm **4.3** · k6 2.2 · kubectl 1.34 (winget 설치). 새 터미널부터 PATH 에 잡힌다. 안 잡히면 `%LOCALAPPDATA%\Microsoft\WinGet\Packages\` 아래 `Helm.Helm_*\windows-amd64`, `Kubernetes.kind_*` 를 PATH 에 더한다. k6 는 `C:\Program Files\k6` |
| Docker | Desktop, VM 메모리 **약 7.5GB.** 이미지 빌드와 kind 클러스터 2개를 **동시에 돌리면 엔진이 멈춘다**(실제로 멈췄다). 빌드 → 클러스터 순서로, 하나씩 |
| 로컬 Flux 시험 | `E:\DockerData\gitops-test-20260929-1245` — bare `Wonseoro.git`·시험 사본 `work`(임시 SSH 서명키가 git 설정에 있음). kind-univ-a 의 Flux 리소스는 시험 뒤 suspend 상태. Git 서버는 `node tests/m4/helpers/git-smart-http-server.mjs <그 폴더> 9418` |
| CI 재현 | CI 통합 잡과 같은 순서를 빈 DB 로: `docker run -d --rm --name ci-pg -e POSTGRES_USER=wonseoro -e POSTGRES_PASSWORD=wonseoro -e POSTGRES_DB=univ_a -p 5499:5432 postgres:16-alpine` → `0001_init`·`0002_db_roles`·`dev-roles`·`verify-constraints`·`seed-dev`·`ci-seed-deadline` 적용 → `DATABASE_URL=…@localhost:5499/univ_a` 로 시험. kind 워크로드 간섭도 없다 |
| 로컬 관측 스택 | kind A `observability` 네임스페이스: Prometheus(KPI 규칙 포함)·Adapter·Grafana(익명 Viewer). Grafana 는 `kubectl -n observability port-forward svc/grafana 13000:80` |
| 중앙 DB 마이그레이션 | `infra/db/central/0001_init.sql`·`0002_vault.sql`·**`0003_summary_names.sql`**(2026-10-01) — `npm run db:migrate:central` 이 셋 다 적용한다 |
| 로컬 DB | compose: `postgres-univ-a` :5432 · `postgres-univ-b` :5442(`--profile multi`) · `postgres-central` :5434 · redis :6379 · minio :9000 |
| 테스트 | DB 가 있어야 통합 테스트까지 돈다 — 명령은 [03-next-steps.md 끝](03-next-steps.md#개발-환경-되살리기). admission-api 323 · server-kit 51 · central-api 29 · event-relay 7 · document-service 8 · krds 5 (전체 423, CI 재현 DB 에서 실패 0·건너뜀 3, 2026-10-01). `app.module.boot.test` 는 실제 AppModule 로 DI 를 조립한다 — 서비스를 직접 `new` 하는 통합 시험이 못 잡는 "서버가 안 뜨는" 결함용. 배포 스크립트 시험은 `npm run test:m4:gitops`(Peak 예약 9건 포함). **DB 통합 시험 전에 kind univ-a 의 API·Relay 를 0 으로 줄인다** — 같은 로컬 `univ_a` DB 를 봐서 시험 행을 먼저 집어 간다(결제 재확인·Relay 시험이 실패하거나 멈춘다). event-relay 시험은 직렬로 돈다 |
| 접근성 시험 | `npm run test:a11y:keyboard`(키보드 완주 — `--width=640`·`320`·`--text-zoom=2`·`--input=touch`·`--browser=edge`) · `test:a11y:focus -- applicant|admin`(전 화면 포커스·스크린리더 재료·가로 스크롤·대상 크기) · `test:a11y:deadline` · `test:a11y:session` · `test:a11y:rate-limit`. 화면 캡처와 같은 전용 DB·포트·서버(`shots-*`)를 쓴다 — 미리보기 서버 5개 한도 때문에 지원자 시험은 서류 워커, 콘솔 시험은 `shots-admin` 을 띄운다. 결과 `tests/a11y/results/`. **CI 에는 아직 없다**(서버 다섯이 필요) |
| 검사 | `npm run db:verify`(DB 제약 20종) · `node scripts/check-deps.mjs`(의존성 선언) · `helm lint deploy/charts/k-admission` · `node scripts/render-runtime-attachment.mjs --check`(runtime 첨부 = 차트 렌더링) · `npm run check:ui-copy`(화면 문구에 설계 번호·개발 안내·구조 설명 금지, T-M5-50) · `npm run check:contracts`(OpenAPI `$ref`·operationId·대장 번호·직전 커밋 대비 호환성, CloudEvents 컴파일·이벤트 타입) |
| 로컬 화면 확인 | kind 와 섞지 않으려면 로컬 프로세스를 CI 재현 DB 에 붙인다 — 중앙 :3100(`DATABASE_URL=…5499/central`)·대학 :3101(`…5499/univ_a`, `CENTRAL_SYNC_URL=http://localhost:3100`, `CORS_ORIGINS=http://localhost:4001`, `OTEL_METRICS_PORT` 를 9464 가 아닌 값으로)·지원자 웹 :4001(`NEXT_PUBLIC_ADMISSION_API`·`NEXT_PUBLIC_CENTRAL_API`). **:3000 은 쓰지 않는다** — kind 시험이 `ka-central` 을 거기 띄운다. 개발 시드 지원자: `44444444-4444-4444-4444-444444444444` / `subj-dev-0001` |
| 동시 작업 | 같은 폴더에서 다른 AI 세션이 커밋할 수 있다(2026-09-30 실제로 겹쳤다 — D-54 번호 충돌). 대장 번호를 쓰기 전에 대장 끝을 다시 읽고, 커밋 전에 `git log` 를 본다 |
| 노션 쓰기 | AI 의 노션 페이지 수정·첨부 교체는 **권한 분류기가 막는다**(2026-09-30, 외부 시스템 쓰기). 읽기(fetch)는 된다. 노션 변경은 [06-notion-changeset.md](06-notion-changeset.md) 로 준비하고 사람이 적용한다 |
| **호스트 포트 전달이 멈춘다** | kind 노드 컨테이너를 멈추거나 다시 켜면 Windows 호스트 → Docker Desktop 포트 전달(`localhost:18081`·`18082`)이 **수십 초~1분 넘게 응답하지 않는다** — 그동안 노드 안 NodePort·Pod·DB 는 정상이다(2026-09-30 구간별 측정). 노드 장애 시험의 부하를 호스트에서 보내면 이 멈춤을 장애로 센다. 그래서 `node-failure-kind.mjs` 는 부하를 kind Docker 네트워크 안 컨테이너(`tests/m4/helpers/load-users.mjs`, `docker run --network kind … node:22-alpine`)로 보낸다. 클러스터를 다시 켠 직후 `curl localhost:18081` 이 멈춰도 1분쯤 기다리면 풀린다 |
| **시험 스크립트는 부하 중 동기 호출 금지** | 부하가 도는 동안 `execFileSync(kubectl…)` 같은 동기 호출은 스크립트 자신의 이벤트 루프를 멈춰, 진행 중 요청의 timeout 을 한꺼번에 터뜨린다(서버에는 오류 없음). 부하 중에는 `execFile` 을 비동기로 쓰고 이벤트 루프 지연을 같이 잰다 |
| **같은 폴더에서 다른 세션이 일한다** | 2026-09-30 에 다른 AI 세션이 같은 작업 폴더·같은 이름(Quackk)으로 동시에 커밋했다(D-55 ~ D-61). 커밋 전에 `git log`·`git status` 로 남의 변경을 확인하고, 문서는 통째로 덮어쓰지 말고 현재 내용에서 고친다 |

## 4. 다음 작업 — 순서와 방법

원본은 [03-next-steps.md「다음 개발 목표」](03-next-steps.md#다음-개발-목표-2026-09-29-설정)와 [M4 마일스톤](milestones/M4-federated-proof.md). 아래는 **실행 방법**까지 붙인 요약이다.

### 목표 1 — 대학 간 장애 격리 증명 (T-M4-42) ✅ 완료

**결과** — `tests/m4/results/isolation-2026-09-27T16-42-39-057Z.json` (로컬 축소 환경)

```bash
docker ps -a                                  # 무엇이 살아 있는지부터
kind get clusters                             # univ-a, univ-b 가 남아 있는지
```

- 클러스터가 없거나 이상하면 `kind delete cluster --name univ-a` 후 README 절차로 다시 만든다
- 이미지 4종(`k-admission/{admission-api,event-relay,document-service,central-api}:dev`)은 **클러스터를 띄우기 전에** 빌드한다.
- `kind load docker-image … --name univ-a` → `helm upgrade --install`(README 명령) → 세 Deployment 가 Ready 인지 확인
- 중앙 API 는 클러스터 밖 컨테이너 `ka-central`(:3000). 없으면 README 명령으로 띄운다
- `univ_b` DB 와 중앙 `university_registry` 의 `UNIV-B` 는 이미 만들어 두었다(볼륨이 남아 있으면 그대로)

**NetworkPolicy 결과** — kindnet이 정책을 실제 집행한다. 양 대학 모두 자기 DB·Redis·중앙·MinIO는 연결되고, 다른 대학 DB·임의 외부·Worker→중앙은 timeout, Worker→자기 API는 연결된다. 공통 values가 양쪽 DB 포트를 열던 문제는 D-45로 수정했다.

**재실행**

```bash
node tests/m4/isolation.mjs
```

A 클러스터 노드 컨테이너를 멈춘 동안 B 대학의 원서 생성→저장→결제→자동 접수, 중앙 "내 원서" 반영, A 복구 후 A 접수까지 확인한다. 첫 실행은 중앙이 현재 `subjectRef` 형식을 버리는 D-46을 발견했고, 수정 후 재실행해 통과했다.

**남은 기록** — 노션 §08에 **시나리오 13(대학 간 격리)** 추가(R6: 사용자 확인 후)

### 목표 2 — 로컬 기능 시험 (kind 위에서, 축소 환경)

| ID | 방법 |
|---|---|
| T-M4-33 | 결제 확인된 원서 하나에 `POST /finalize` 100회 동시 → `submission` 1건 (k6 또는 Node 스크립트) |
| T-M4-34 | 시간 압축판 `payment-recovery.mjs` ✅. **실제 시간 판**: 이미지 재빌드·`kind load` 뒤 `kubectl --context kind-univ-a -n kadmission-app set env deploy/univ-a-api MOCK_PG_CONFIRM_DELAYS_S=60,300,900,1800` → `node tests/m4/pg-delay-realtime.mjs`(약 35분: 지연마다 콜백 경로·폴링 경로, 늦은 콜백 중복 처리) → `… set env deploy/univ-a-api MOCK_PG_CONFIRM_DELAYS_S-` 로 되돌린다. 콜백 서명은 로컬 개발 기본 비밀 |
| T-M4-35 | 압축판 `central-outage.mjs` ✅. **실제 시간 판** `node tests/m4/central-outage-realtime.mjs`(기본 120분, `--minutes=2 --every=30` 사전 점검). 중앙을 멈춘 채 5분마다 접수·4건 중 1건 취소, 1분 표본. **그동안 univ-a 를 건드리지 않는다**(재배포·DB 시험 금지). 취소는 접수 전에만 있어 중앙 "내 원서" 가 아니라 중앙 요약 `CANCELLED` 로 확인한다 |
| T-M4-39 | 단일 노드 ✅. 다중 노드: `kind-univ-a-multinode.yaml`(기본 판정)·`kind-univ-a-multinode-tuned.yaml`(grace 16초) — 절차는 아래 목표 3 끝. 시험이 죽은 노드의 API Pod 를 축출해 대체 Pod 가 살아 있는 zone 에 놓이는지(nodeTaintsPolicy)도 본다 |

### 목표 3 — 차트에 남은 운영 기능

T-M4-09 PgBouncer는 두 kind 클러스터에 배포했고 직접 DB 우회 차단·동시 30쿼리·upstream 최대 10/10을 확인했다.
결과는 `tests/m4/results/pgbouncer-2026-09-28T01-26-13-047Z.json`. T-M4-07은 완료했다(ADR-0006). 대학별
`peak-schedule.yaml` 을 예약 워크플로(`.github/workflows/peak-mode.yml`)가 10분마다 `peak-mode.yaml` overlay 로 계산해
바뀐 경우만 서명 커밋하고, Flux 가 Pull 해 API 최소 replica 를 올리고 내린다. 앱은 억제~종료 시각에만 자동 대조를 멈춘다.
로컬 kind 에서 2→3(push 뒤 62초)·원복(33초)을 확인했다 — `tests/m4/results/peak-mode-gitops-2026-09-29T11-43-36-484Z.json`,
재실행 절차는 `deploy/gitops/local/README.md`. 첨부 values-m 예시 시각이 영구 억제를 만드는 문제는 D-49 — values-m v1.2 에서 비웠고 노션 첨부 교체만 남았다. 예약 워크플로는 저장소 변수 `PEAK_MODE_ENABLED=true` 일 때만 러너를 띄운다(opt-in).

T-M4-20·T-M4-24는 완료했다. 계측은 `packages/server-kit` 에 모였다 — `telemetry-sdk`(SDK 진입점, **index 로 내보내지 않는다**:
index 를 거치면 `pg` 가 먼저 로드돼 DB span 이 빠진다), `telemetry/http`(HTTP 지표·span), `telemetry/trace`(traceparent 전파·
`withSpan`), `telemetry/logger`(한 줄 JSON·trace_id·마스킹). 네 서비스의 `src/instrumentation.ts` 가 main 의 첫 import 로
SDK 를 켜고 전역 Nest 로거를 바꾼다. `scripts/check-logging.mjs` 가 CI 에서 console 직접 출력·로거 누락을 막는다.
kind A 에 Flux(서명 병합 → Pull)로 새 이미지를 배포해 세 워크로드 수집 up=1·구조화 로그를 확인했다 —
`tests/m4/results/telemetry-kind-2026-09-29T14-05-37-946Z.json`. A 의 API·Relay 와 클러스터 밖 `ka-central` 은 D-50 이후 이미지다(2026-09-30). A 의 서류 워커는 계측 추가(`506d1d2`) 시점 이미지다(카운터 0 초기화 이전). 2026-09-30 부터 A·B 모두 최신 이미지(API·Relay·서류 워커)다. B 의 Helm release 는 이전 차트 revision 이라 새 env(`THROTTLE_MODE` 등)가 없다 — 앱 기본값으로 동작한다.
**Flux 가 소유한 release 는 `helm upgrade` CLI 로 바꿀 수 없다**(server-side apply 충돌) — 시험 사본에 서명 병합 → bare 로 push → Flux 재개.

T-M4-21~23 도 끝냈다. admission-api 가 결과별 카운터(자동저장·결제 재검증·Finalize)와 DB 게이지(Outbox·중앙 반영·서류 대기·잠금 대기)를
내고, 비율은 `deploy/platform/observability/kpi-rules.yaml` recording rule 에서만 정의한다. Grafana 대시보드 3종은
`dashboards/*.json` 이고 kind A 에 Grafana 를 올려 렌더링까지 확인했다(설치·검증 명령은 관측성 README). 이 과정에서
**취소 이벤트가 CloudEvents 스키마와 달라 중앙이 한 건도 받지 못하던 것(D-50)** 을 찾았다 — 이벤트 본문은 이제
`apps/admission-api/src/common/central/central-events.ts` 한 곳에서 만들고 스키마로 직접 검증한다.

T-M4-40 도 끝냈다(ADR-0007). 요청 한도는 **IP 가 아니라 인증된 지원자** 기준이다 — `apps/admission-api/src/common/throttle/`.
지원자×요청 종류 토큰 버킷과 위험점수(소유권 검사 실패·다수 원서·한도 초과, 5분 반감기)를 Pod 메모리에 둔다. 정상 세션의
최종제출은 막지 않는다. `THROTTLE_MODE=enforce|observe|off`(차트 `throttle.mode`). kind NAT 시나리오(단일 출발지 정상 200명 +
봇 5개)를 세 번 돌려 **세 번 모두 정상 사용자 429 = 0**. 그중 두 번은 과부하로 API Pod 가 재시작했는데, 원인은
멱등 기록(`idempotency.interceptor`)의 기다리지 않은 Promise 가 DB 풀 포화로 거부되며 **프로세스를 죽인 것**이었다 — 고쳤고,
DB 풀 포화는 이제 500 대신 503 재시도 안내다. 수정 이미지로 네 번 더 돌려 재시작 0·정상 사용자 429 0 을 확인했다. 5xx·지연은 봇 없는 기준 실행(`nat-bot-kind.mjs 90 no-bots`)에서도 같아
축소 환경 용량(API Pod 2·Pod 당 DB 연결 5)의 한계다 — 시험은 인수기준만 판정하고 용량은 관찰로 기록한다.
OpenAPI 에 429 를 적는 것은 노션 §03 첨부 교체와 함께다(D-51).

T-M4-37 은 Redis 를 멈추고·비워도 접수 흐름이 그대로임을 확인했다(`tests/m4/redis-outage-kind.mjs`). **현재 구현은 Redis 를 쓰지 않는다** —
차트의 Redis 주소·NetworkPolicy 는 설계(세션·캐시)를 위한 자리다. 세션을 Redis 에 두는 인증(M5)을 붙이면 다시 돌린다.

T-M4-39 는 🟡 다. 평소 로컬은 노드가 하나라, 시험할 때만 다중 노드 클러스터를 만든다 —
`kind create cluster --config deploy/local/kind-univ-a-multinode.yaml`(univ-m, NodePort 18082) → 이미지 `kind load` →
`helm upgrade --install univ-a … -f values-s -f values-local -f values-univ-a -f peak-mode-univ-a -f values-multinode` →
`node tests/m4/node-failure-kind.mjs` → `kind delete cluster --name univ-m`. **메모리 때문에 그동안 univ-a·univ-b 노드를 멈춘다.**
노드 판정 시간을 줄인 비교는 같은 절차에서 설정 파일만 `kind-univ-a-multinode-tuned.yaml`(controller-manager grace 16초·kubelet 상태 보고 4초)로 바꾼다(ADR-0008). 차트 기본값이 `nodeTaintsPolicy: Honor` 라, 옛 동작(Ignore)과 비교하려면 `--set nodePlacement.nodeTaintsPolicy=Ignore` 로 배포한다.
시험 클라이언트는 요청마다 새 TCP 연결을 연다 — keep-alive 로 재사용하면 요청이 한 Pod 로만 가서 장애가 안 보인다(처음에 그랬다).
결과: drain 무중단, 강제 정지는 NotReady 판정(49초)까지 약 1분·10% 끊김 후 자동 회복. 원래는 DB 풀에 쿼리 시간 제한이 없어
죽은 노드의 PgBouncer 로 열린 연결이 살아남은 Pod 의 요청까지 끝없이 붙잡았다(141초 내내 72% 실패) — `server-kit` Db 에
`queryTimeoutMs`·keep-alive·끊긴 연결 폐기를 넣어 고쳤다. 남은 구간은 D-52(Edge 재시도·노드 판정 시간·zone 수).

다음은 T-M4-35 중앙 2시간 단절 실제 시간 판이다. 각 인수기준은 [M4 마일스톤](milestones/M4-federated-proof.md).

T-M4-08은 A kind에 Prometheus `29.35.0`·Adapter `5.3.0`을 설치하고 RPS·p95 지연·처리 중 요청 수를
Custom Metrics API와 HPA에서 모두 확인해 완료했다. 설정은 `deploy/platform/observability/`, 결과는
`tests/m4/results/hpa-custom-metrics-2026-09-29T03-27-10-000Z.json`이다. 로컬에는 metrics-server가 없어 CPU 지표는
`<unknown>`이었고 DB 연결 예산 때문에 maxReplica만 4로 낮춰 시험했으며, 시험 뒤 로컬 HPA는 다시 껐다.

Docker/kind 노드 강제 종료에서 PgBouncer의 `/tmp/pgbouncer.pid`가 `emptyDir`에 남아 재기동을 막는 문제도 수정했다.
진입점이 새 컨테이너 기동 직전에 stale PID 파일을 제거한다. 수정 이미지를 A/B에 배포한 뒤 A 노드를 강제 재시작했고,
PgBouncer가 같은 Pod에서 오류 없이 재기동하여 A의 앱 전체와 관측 스택이 Ready로 복구되는 동안 B는 계속 정상임을 확인했다.

T-M4-05는 Flux 2.9.5를 대학 클러스터 내부 Pull 실행 주체로 채택했다(ADR-0005). 운영 bootstrap은 `main` HEAD의
SSH/PGP 서명을 검증하며 HelmRelease는 `kadmission-app` 전용 `release-controller`로만 수렴한다. 로컬 A kind에서
signed HEAD의 SourceVerified·Helm v25 적용, unsigned HEAD의 `InvalidCommitSignature` 거부와 last-good 유지,
replica drift 1→2 자동 복구를 확인했다. 결과는 `tests/m4/results/gitops-pull-2026-09-29T04-24-15-000Z.json`.
시험용 Flux 리소스는 성공 상태에서 suspend했고 앱은 Ready로 유지했다. 이미지 Cosign admission 검증은 실제 Registry·신뢰키가 필요한 M5 공급망 게이트다.

T-M4-38은 로컬 축소 환경에서 MinIO 완전 단절 중 카탈로그 20회·원서 생성·자동저장이 정상이고 직접 업로드만 실패하는 것을 확인했다.
MinIO 복구 515ms 뒤 기존 단기 URL 업로드와 서버 검증까지 통과했다. 결과는
`tests/m4/results/object-storage-outage-2026-09-28T06-14-19-725Z.json`.

Docker 데이터는 `E:\DockerData\DockerDesktopWSL`로 이전되어 C: 여유 공간이 약 22GB로 회복됐다.
Docker Desktop AI Inference 엔진은 이 프로젝트에서 쓰지 않으며, stale `dockerInference` 소켓으로 재기동이 충돌해
`settings-store.json` 의 `EnableDockerAI=false`로 비활성화했다. 이전 공간 부족 때 B kind의 Node 이미지 레이어가
손상되어 B 클러스터만 재생성했다. 대학 DB는 외부 Docker volume이라 데이터 손실은 없다.

### 목표 4 — 노션 반영 (R6) · 저장소 준비 끝, 노션 쓰기 대기

페이지별 변경안(첨부 5종의 바이트·SHA-256, 바꿀 문구)은 **[06-notion-changeset.md](06-notion-changeset.md)**. 2026-09-30 에 AI 가 적용하려다 권한 분류기에 막혔다(외부 시스템 쓰기) —
같은 결과를 다른 도구로 우회하지 않는다. 사람이 적용하거나 사용자가 노션 쓰기를 허용한다. 적용하면 대장 해당 항목을 ✅ 로, spec-assets README 의 ⚠️ 를 ✅ 로 바꾼다.

첨부 교체 방법: 노션 MCP 의 file upload 로 저장소 파일을 **그대로** 올리고(바이트 수 확인) 페이지의 file 블록을 바꾼다.
노션 첨부를 **내려받는** 것은 MCP 로 안 된다 — 로그인된 브라우저에서 `/api/v3/getSignedFileUrls` (절차: 대장 D-5).

## 5. 사람이 해야 하는 것 (AI 가 대신 못 함)

| 항목 | 상태 |
|---|---|
| K-PaaS(또는 클라우드) 시험 환경 | 3,000 CCU·1,000 RPS·6시간 Soak·DB Failover 실측(T-M4-30~32·36·41)에 필요. 없음 |
| 제출 PDF 정정 (D-2·D-3) | 개발보고서의 "Java/Spring" 표기 → NestJS·TypeScript. 정정 문구 준비됨 — [07-submission-errata.md](07-submission-errata.md) |
| 노션 반영 적용 | [06-notion-changeset.md](06-notion-changeset.md) — AI 쓰기 차단 |
| K-PaaS 착수 때 정할 것 | 노드 판정 시간(`node-monitor-grace-period`) 조정 가능 여부·zone 수·Gateway API 컨트롤러(ADR-0008, D-53) · clamd 배치(사이드카·공용 서비스)와 서명 DB 갱신 경로(D-58) · DB 서버 시각 동기 감시(D-61) |
| 실 clamd 로 검사 확인 (D-58) | ClamAV 어댑터는 가짜 clamd 로만 시험했다. `clamav/clamav` 이미지(약 300MB+서명 DB)를 내려받아 `SCANNER_ENGINE=clamav`·`CLAMD_HOST` 로 한 번 돌려 본다 — 내려받기는 사람이 승인한다 |
| Peak Mode 예약 워크플로 켜기 | GitHub environment `peak-mode` + secret `PEAK_MODE_SSH_SIGNING_KEY`, 저장소 변수 `PEAK_MODE_ENABLED=true`, 대학 `wonseoro-git-authors` 에 예약 자동화 공개키 추가 (ADR-0006) |
| ~~values-m 커넥션 수치 (D-44 ⑦)~~ | 2026-09-30 AI 결정: Pod 당 38·예산 400 유지 |
| 실물 Firefox·Safari 확인 (T-M5-47) | 이 PC 에 없다. 실물 Firefox(Windows)·iPhone Safari 15.4+ 로 접수 흐름을 한 번 따라가거나, 시험용 브라우저(Playwright Firefox·WebKit 약 300MB) 내려받기를 승인하면 AI 가 `tests/a11y/` 를 그 브라우저로 돌린다 — [09](09-accessibility.md#지원-브라우저-2026-10-01-ai-판단) |
| 실제 스크린리더 청취 (T-M5-48) | NVDA·센스리더·VoiceOver 로 듣는 검사. 전 화면 점검 결과의 Tab 자리별 대본(`say`)을 대조표로 쓴다 |

## 6. 전체 남은 규모

146개 중 99개 완료, **47개 남음** (2026-10-02 보안 파이프라인 T-M5-20~26 완료). **A. AI 가 이 PC 에서 끝낼 수 있는 것 26개 · B. 외부 환경(K-PaaS·HA DB·PG 계약) 12개 · C. 사람·기관 9개**(T-M5-47 나머지 실물 브라우저 포함).
목록과 권장 순서는 [03-next-steps.md 「완성까지 남은 단계」](03-next-steps.md#완성까지-남은-단계-2026-10-01-전수-점검).

## 7. 어디에 무엇이 있나

| 찾는 것 | 위치 |
|---|---|
| 지금 할 일 | [03-next-steps.md](03-next-steps.md) |
| 단계별 태스크·인수기준 | [milestones/](milestones/) |
| 설계와 구현이 다른 곳 63건 | [02-spec-discrepancy-register.md](02-spec-discrepancy-register.md) |
| 화면 캡처·다시 찍는 법 | [screenshots/README.md](screenshots/README.md) |
| 화면 제품화 — 화면 결함·개발 흔적 전수 목록(U-1~U-59)·결정·문구 검사 | [08-ui-production-readiness.md](08-ui-production-readiness.md) |
| 접근성 — 시험·찾은 결함·세션 만료·CAPTCHA 결정·지원 브라우저 | [09-accessibility.md](09-accessibility.md) · 시험 `tests/a11y/` · KRDS `LiveRegion`·`TableScroll`·`Alert focusKey`·`Card titleId/titleLevel` |
| 개인정보·법정 고지 — 원서에 받을 항목·필수 절차·고지 체크리스트·지금과의 차이(G-1~G-15)·법무 쟁점 | [10-admission-privacy-and-legal-notices.md](10-admission-privacy-and-legal-notices.md) (2026-10-02 현행 법령 원문 기준, 법률자문 아님) |
| 흉내·미연결 점검 결과와 일부러 남긴 흉내 | [04-production-readiness.md §7](04-production-readiness.md#7-흉내미연결-전수-점검-2026-09-30) |
| 노션 문서 지도·동기화 규칙 | [01-notion-sync-protocol.md](01-notion-sync-protocol.md) |
| 왜 이렇게 정했나 | [adr/](adr/) — 최신 ADR-0009 퍼즐형 CAPTCHA 를 두지 않는다(한도에 걸린 사람의 접근 가능한 길) · ADR-0008 노드 장애 흡수 |
| 배포 | `deploy/` — 차트 `charts/k-admission`, 대학별 `universities/`, 로컬 `local/` |
| API 계약 | `packages/contracts/openapi/k-admission.v1.yaml` (v1.6.0) — 컨트롤러와 다르면 계약 적합성 시험이, 계약 파일이 깨지거나 비호환이면 `check:contracts` 가 깨진다 |
| 사람 말 사전(상태·행위·예외 등 화면 이름) | `packages/contracts/src/labels.ts` — 화면은 내부 코드를 그대로 보이지 않는다 (T-M5-51) |
| 날짜·시각 표기·아이콘 | `packages/krds/src/format.ts`(언제나 한국 시간)·`icon.tsx`(SVG) — 화면은 `toLocaleString`·이모지를 직접 쓰지 않는다 (T-M5-54) |
| 오류 문구표(오류 code → 화면 제목·설명) | `packages/contracts/src/problem-text.ts` — 화면은 서버 오류 문구를 그대로 보이지 않는다. 조사 함수 `josa.ts` (T-M5-52) |
| 공통원서 표준 항목 | `packages/contracts/src/common-profile.ts` — 중앙 Vault 검증·지원자 화면·설정 검사가 같이 쓴다 (D-57) |
| DB 스키마 | `infra/db/migrations/0001_init.sql`(= 노션 §02 첨부 v1.2) · `0002_db_roles.sql` |
