# 인수인계 — 다음 작업자(사람·AI 공통)가 먼저 읽는 문서

> 작성: 2026-09-29 · **최종 갱신 2026-10-05** · 원격 반영 여부는 `git status --branch`와 `git log origin/main..HEAD`로 확인한다 — 원격 CI 결과는 GitHub Actions 에서 확인한다
>
> **다른 컴퓨터·다른 AI 도구(Codex 등)로 이어받는다면 먼저 [§0 새 환경에서 시작하기](#0-새-환경에서-시작하기--다른-컴퓨터다른-ai-도구) 를 따른다.**
>
> **세션 마감 상태(2026-10-05 Claude → Codex 로 넘김) — 넘겨받는 쪽이 먼저 볼 것**
> 1. **push 안 함** — 로컬 `main` 은 `origin/main` 보다 **37커밋** 앞이다(앞 세션 17 + 이번 20 — 아래 11개 뒤에 인계 정리 `05cf471`·유출 판정의 범위 대조 `1259e34`·복구 검증 고아 행 수정 `3b7dbb8`·낡은 숫자 정리 `aaf4826`·`febe0b6`·관리 API 가짜 서버 시험과 접근성 러너 준비 `f0958d5`·대조 기록만 보기 필터 `7b755c8`·인계 마감 `311ac44`·이 숫자를 바로잡은 커밋. 정확한 수는 `git rev-list --count origin/main..HEAD`). 이번 11개(커밋 순): `18c3d18` 권한 변경 기록 3년 보관(0011·수집 도구·렐름) → `fada7b9` 차트 CronJob → `8181d3e` 감사자 콘솔·OpenAPI 1.20.0 → `f44c000` 캡처 43 → `6a44d4e` 유출 범위 산정·통지/신고 판정(G-14) → `7b3804f` 권한 기록 WORM → `169a500` 수집 경보 → `70352e2` WORM 정기 대조·경보 → `bf2b342` CI 에 외부 게이트 → `3922461` 범위 산정에 권한 기록 → `57f77a2` 접근성 CI 워크플로. 모두 작성자·커밋한 사람 `ryan-ahn-song <ryansong0805@gmail.com>`, `Co-authored-by`·`Signed-off-by` 줄 0개(`git log origin/main..HEAD` 로 확인). push 는 사용자 몫
> 2. **마감 검증(2026-10-05, `ci-pg` :5499)** — admission-api **437개 중 434 통과·3 skip·0 실패**(마지막 실행), central-api **41 통과**, 보안 선별 **250 통과·skip 0**, DB 제약 **25종 PASS**, 외부 게이트 단위 **34 통과·skip 0**, 로그인 서버 관리 API 가짜 서버 단위 3 통과, `check:contracts`(OpenAPI 1.20.0·74 operation)·`check:ui-copy`·runtime 첨부 일치·두 웹 운영 빌드 통과, 실제 Keycloak `test:auth:grants` **12 통과**, 접근성 콘솔 1280/320 각 25화면(2026-10-05 마지막 — 「바꾼 사람을 모르는 변경만」 필터 포함)·지원자 각 29화면 문제 0·키보드 완주 118키 문제 0, WORM 통합 5 통과(Object Storage :9000), 복구 검증 `ops:restore-verify` **11개 통과**(시험 정리가 남기던 고아 대조 예외를 고친 뒤 — 문서 14)
> 3. **못 돌린 것** — 새 차트 CronJob(`accessGrantSync`)을 kind 에서 실제로 돌리지 않았다(kind 클러스터 없음 — 렌더링·렌더링 거절만 확인). 경보 규칙은 YAML 파싱만(promtool 없음). `a11y.yml` 워크플로는 원격에서 한 번도 돌리지 않았다(push 뒤 수동 실행으로 첫 확인). 실제 유출 사건 훈련은 없다(T-M6-08·10 사람 몫)
> 4. **환경이 바뀐 것** — 대학 DB 마이그레이션 **0001~0011**(`ci-pg`·`ui-shots-pg` 적용함, 로컬 compose·kind 는 `npm run db:migrate`). 렐름 `wonseoro-staff` 에 관리 이벤트·수집 클라이언트 — **로컬 Keycloak 은 `--force-recreate` 해야 반영**(지금 띄워 둔 컨테이너는 반영돼 있다). 보존 설정을 쓰는 대학 설정은 `ACCESS_GRANT_LOG`(1095일 이상) 명시 필수. 새 환경변수 `AUDIT_WORM_VERIFY_INTERVAL_MS`(기본 하루), 수집 도구 `OIDC_STAFF_ISSUER`·`ACCESS_GRANT_CLIENT_ID`·`ACCESS_GRANT_CLIENT_SECRET`
> 5. **실행 중일 수 있는 것** — 컨테이너 `ci-pg`·`ui-shots-pg`·`wonseoro-dev-keycloak-1`(:18080)·`object-storage`(:9000)·compose DB 들. 미리보기 서버는 모두 껐다. `ui-shots-pg` 의 `access_grant_log` 에는 접근성 순회·캡처가 넣은 시험 기록이 쌓여 있다(추가 전용이라 못 지운다 — `prepare.sh db` 로 DB 를 다시 만들면 비워진다). 로컬 RustFS 에 3년 잠긴 시험 버킷 `audit-worm-verify-once-*` 하나가 남았다
> 6. **이어서 할 일** — AI 가 이 PC 에서 할 일은 사실상 없다(A 목록 0, 개인정보 차이 G 중 AI 몫 모두 끝 — G-14 는 도구·초안까지). 남은 것은 외부·사람·기관(03 B·C, [문서 18](18-pilot-execution-package.md)·[19](19-breach-response-runbook.md))과 노션 반영([06](06-notion-changeset.md) — OpenAPI **1.20.0** 바이트·해시, D-91·D-92 본문). push 뒤 `a11y.yml` 수동 실행 결과를 확인한다. kind 를 다시 만들 일이 있으면 `accessGrantSync` CronJob 을 켜서 Job 한 번을 실제로 돌려 본다
>
> **2026-10-05 Claude 세션 — G-15 권한 부여·변경·말소 기록(D-91).** 관리자 SSO(T-M5-10)가 끝나 AI 몫이 된 마지막 개인정보 차이. 렐름 `wonseoro-staff` 에 관리 이벤트·읽기 전용 수집 클라이언트 `access-grant-collector` 를 더했다(**로컬 Keycloak 은 `up -d --force-recreate keycloak` 로 다시 가져와야 한다**). 대학 DB 마이그레이션 **0011** `access_grant_log`(추가 전용·DB 가 매기는 해시 체인·`access_grant_log_verify()`), 수집 도구 `node apps/admission-api/dist/tools/access-grant-sync.js [sync|verify]`(이벤트를 바꾼 관리자 ID 와 함께 옮기고, 실제 권한과 대조 — 이벤트 없이 바뀐 권한도 남긴다, 이벤트가 꺼져 있으면 종료 코드 1). 보존 항목 `ACCESS_GRANT_LOG`(하한 1095일) — **보존 설정을 쓰는 대학 설정은 이 항목을 명시해야 한다**. 차트 `accessGrantSync`(1시간 CronJob, 기본 꺼짐 — **운영에서 `api.env.AUTH_MODE=oidc` 면 켜야 렌더링된다**, runtime 첨부 불변). 보안 감사자 콘솔 「권한 변경 기록」(`/access-grants`, OpenAPI **1.20.0** `listAccessGrants` — 노션 첨부 교체 대기, 06 의 바이트·해시). 접근성 순회 중 **트리거 함수가 검색 경로에 기대던 결함**(관리자 psql 에서 넣으면 실패)과 **KRDS 선택 칸이 브라우저 기본 검사로 이유 없는 "잘못됨" 을 알리던 것**(「대조·예외」 처리 코드)을 찾아 고쳤다. 최종 검증: admission-api **433개 중 430 통과·3 skip·0 실패**, 보안 선별 **250 통과·skip 0**, DB 제약 **25종** PASS(`ci-pg`), 실제 Keycloak `npm run test:auth:grants` **12개 통과**, 콘솔 1280/320 각 **24화면**·지원자 1280/320 각 **29화면** 문제 0, 키보드 완주 **118키** 문제 0, 두 웹 운영 빌드·`check:contracts`·`check:ui-copy` 통과. `ci-pg`·`ui-shots-pg` 에 0011 적용함(`ui-shots-pg` 에는 순회가 넣은 시험 기록이 쌓인다 — 지울 수 없는 표) — 로컬 compose·kind DB 는 다음 시험 전에 `npm run db:migrate`. 화면 캡처는 **43장**(새 `admin/43-access-grants` — `capture.mjs admin-grants`, 렌더링 문구 검사 통과). **운영 빌드(`npm run build -w …web`)를 개발 서버가 도는 중에 하면 그 개발 서버의 `.next` 가 깨진다**(모듈을 못 찾는 화면) — 빌드 뒤에는 `shots-*` 미리보기를 다시 띄운다.
> **같은 세션 — 권한 변경 기록 WORM.** 감사 WORM 스케줄러가 `access_grant_log` 도 순번으로 이어 Object Lock 조각으로 내보낸다(보관 = 감사 WORM 보관과 1095일 중 긴 쪽), `verifyGrantWorm` 이 트리거를 끄고 고치거나 지운 줄을 찾는다. `audit-worm.integration.test` 5개 통과·skip 0(Object Storage :9000 필요). **WORM 정기 대조**도 붙였다 — 대학 API 리더가 하루마다 두 기록의 조각 전부를 DB 와 맞춰 지표·경보(`AuditWormMismatch`·`AuditWormVerifyStale`, `expiry-rules.yaml`)로 알린다(새 환경변수 `AUDIT_WORM_VERIFY_INTERVAL_MS`, 기본 하루). 수집 Job 경보 `AccessGrantSyncStale`·`AccessGrantSyncFailing` 도 같은 파일 — promtool 검사는 못 했다(YAML 파싱만).
> **같은 세션 — G-14 유출 통지·신고 준비(D-92).** 법 원문(제34조 2026. 9. 11. 시행, 시행령 제39·40조)을 다시 읽고 절차서 초안 [문서 19](19-breach-response-runbook.md), 범위 산정 `npm run ops:breach-scope`(감사·동의 기록으로 정보주체 수·민감/고유식별·72시간 기한·신고 대상 — 화면 DB 에서 실제 실행), 사건 기록 판정 `npm run ops:breach-notice-acceptance`(+시작 양식 `deploy/pilot/breach-notice.example.yaml`, 빈 양식은 의도대로 실패)를 만들었다. 단위 8개 통과·skip 0, `test:ops:external-gates` 에 포함. 확정(보호책임자·연락망·가능성 통지 기준)은 T-M6-08 사람 몫이라 **전체 125/146 은 그대로**.
>
> **2026-10-03 세션 정리(다른 도구가 이어받을 때 여기부터)** — 이 날 끝낸 것: 보안 통제 단계 3~6(필드 암호화·Vault·break-glass·실 clamd, D-70~D-73),
> Outbox 보관(T-M4-10, D-74), 운영 자동화(만료 경보 T-M5-65·WORM T-M3-03 D-75·복구 검증 T-M5-62·Writer fencing T-M5-63 D-76),
> Pilot 도구(CSP 사전 점검 T-M6-03·처리흐름도 T-M6-11·온보딩 문서 T-M6-14·Config 호환 시험 T-M6-02 D-77·전형 Schema 온보딩 T-M6-01·상태 페이지/대학별 장애 배너 T-M6-06 D-78).
> **2026-10-04 (2) — T-M6-07 개인정보 최소 상담 조회 완료(D-79, 커밋 `314fb62`).** 전체 **125/146**. **A 목록(AI 가 이 PC 에서 끝낼 태스크)은 모두 끝났다.** 남은 21개는 외부 환경·사람·기관 몫(문서 03 B·C).
> **2026-10-04 Claude 세션 마감 정리(다른 도구가 이어받을 때 여기부터)** — 이 세션에서 끝낸 것(커밋 순): T-M6-07 상담 조회(D-79, `314fb62`) → 문서 10 G-1 시드 「자기소개」 제거·설정 검사 경고(`2ab8e6d`) → G-4·G-6 대학 고지(처리방침·위탁·보호책임자·전형료 반환, D-80, `93986f7`) → G-2·G-11 원서 동의(D-81, `5d7d531`) → G-3 공통원서 수집·이용 동의·제공 고지(D-82, `988c3f3`) → G-10 일부 공통원서 삭제(`810350c`) → U-51 접수번호로 증적 열기. OpenAPI **1.14.0**(노션 첨부 교체 대기 — 06 의 바이트·해시). 사용자 요청대로 사용량 약 10% 가 남기 전에 멈췄다.
> 마감 때 확인: admission-api 395개 중 392 통과·3 skip·0 실패, central-api 41 통과, 보안 선별 시험 221 통과(`test:security`), DB 제약 23종 PASS, 두 웹 운영 빌드·`check:contracts`·`check:ui-copy` 통과, 지원자 1280/320 각 22화면·관리자 1280/320 각 13화면 접근성 문제 0, 키보드 완주 문제 0.
> **2026-10-04 Codex 세션 — D-83 로컬 Object Storage 교체 완료.** 사라진 `quay.io/minio/minio:latest` 대신 로컬·시험만 RustFS 1.0.1 고정 digest로 바꿨다. 서비스 이름은 `object-storage`, 앱·운영 계약은 `S3_*`/S3 호환 Object Storage로 그대로다. 기존 `.data/minio`는 보존하고 새 named volume을 쓴다. 명시적 브라우저 CORS, 비루트 UID 10001, `no-new-privileges`를 적용했다. Trivy High/Critical 0, WORM 3개 실제 실행·통과(삭제·보관 단축 거절), admission-api 395개 중 392 통과·3 skip·0 실패, 키보드 완주 105키·문제 0, 지원자 1280/320 각 22화면·296자리·문제 0, 저장소 실제 중단·복구 시험 통과. 원격 push는 사용자 몫이다.
> **2026-10-04 (3) Claude 세션 — G-10 남은 부분 완료(D-84).** 대학 원서의 열람·정정·삭제·처리정지 요청(지원자 `/privacy/{원서}`)과 입학처 콘솔 처리 큐(`/privacy`, 법정 기한 10일·기한 지남 표시·회신 한 번). 마이그레이션 **0009**, OpenAPI **1.15.0**(노션 첨부 교체 대기 — 06). 검증: admission-api **402개 중 399 통과·3 skip·0 실패**, central-api 41 통과, 보안 선별 시험 **229 통과·건너뜀 0**, `check:contracts`·`check:ui-copy` 통과, 접근성 지원자 1280/320 각 25화면·콘솔 1280/320 각 16화면 문제 0, 키보드 완주 105키 문제 0.
> **이 PC(Windows 10, `D:\Project-Local\wonseoro`) 환경 메모** — PowerShell PATH 에 git 이 없다. GitHub Desktop 의 git 을 쓴다: `C:\Users\ARK CLOUD\AppData\Local\GitHubDesktop\app-3.6.3\resources\app\git\cmd\git.exe`(`check:contracts` 의 HEAD~1 호환 검사도 git 이 PATH 에 있어야 돈다 — `$env:PATH = "<그 폴더>;$env:PATH"`). `ci-pg` 에 **`central` DB 가 없어 중앙 보안 시험 33개가 건너뜀으로 끝나고 있었다** — 2026-10-04 HANDOFF §0 순서대로 만들고 중앙 0001~0005 를 적용했다. `ci-pg`·`ui-shots-pg` 에는 0009 를 적용했다. PowerShell 의 `<` 는 입력 재지정이 안 된다 — SQL 은 `docker cp 파일 컨테이너:/tmp/x.sql` 뒤 `psql -f` 로(파이프는 한글이 깨진다).
> **같은 세션 — G-8 민감정보 서류 별도 동의 완료(D-85).** 설정 `sensitiveDocuments`, 4단계 별도 동의 뒤 업로드, 서류가 있으면 동의 필수. OpenAPI **1.16.0**. **개발 시드가 바뀌었다**(선택 서류 `DISABILITY_CERT`·동의 `SENSITIVE_HEALTH`) — `ci-pg`·`ui-shots-pg` 에는 다시 적용했다. kind·로컬 compose DB 는 다음 시험 전에 `seed-dev.sql` 재적용. 검증: admission-api **407개 중 404 통과·3 skip·0 실패**, 지원자 1280/320 각 26화면 문제 0, 키보드 완주 109키 문제 0.
> **같은 세션 — G-12 지원 제한 고지 완료(D-86).** 접수 홈 「지원 전 확인」(대학 고지 `notices.applicationRules`) 체크 뒤에만 원서 시작, 확인은 감사에 문안 해시. OpenAPI **1.17.0**. 시드에 문안이 더해졌다(`ci-pg`·`ui-shots-pg` 재적용함). **화면으로 원서를 시작하는 스크립트는 체크를 켜야 한다** — 키보드 완주·순회·캡처(`ackRules`)는 고쳤다. 검증: admission-api **408개 중 405 통과·3 skip·0 실패**, 지원자 1280/320 각 26화면 문제 0, 키보드 완주 114키 문제 0. 캡처 스크립트(`capture.mjs`)는 고쳤지만 이번에 돌리지 않았다.
> **같은 세션 — G-13 보존 항목 분리 완료(D-87).** `APPLICANT_PII`·`DOCUMENT_FILE` → 접수·미접수 4항목(`*_UNSUBMITTED`·`*_SUBMITTED`). 접수 신원은 10년 하한·원서보다 먼저 파기 금지. **옛 항목 이름은 이제 설정 검사가 거절한다** — 보존 설정을 쓰는 대학 설정·시험은 새 이름 넷을 명시한다. 검증: admission-api **409개 중 406 통과·3 skip·0 실패**, 보안 229 통과·skip 0, 콘솔 1280/320 각 16화면 문제 0.
> **같은 세션 — G-9 항목 단위 별도 동의 완료(D-88).** 양식 항목 `x-sensitive-consent: <동의 코드>` — 3단계 그 항목 위 별도 동의 뒤에만 칸, 동의 없이 값 저장 400, 값이 있으면 동의 필수. 시드에 선택 항목 `passportNumber`·동의 `PASSPORT_COLLECTION`(재적용함). OpenAPI **1.18.0**(설명만). 검증: admission-api **411개 중 408 통과·3 skip·0 실패**, 지원자 1280/320 각 27화면 문제 0, 키보드 완주 118키 문제 0.
> **같은 세션 — G-5 전형료 반환·면제 감액 신청 완료(D-89).** 마이그레이션 **0010** `fee_refund_request`, 지원자 `/refund/{원서}`(결제 확인 원서만 — 원서 화면 「전형료 반환」 카드), 콘솔 `/refunds`(범위 operator, 열기·결정 Step-up). 계좌는 신청할 때만 받아 원서 데이터 키로 봉함·끝 네 자리만. OpenAPI **1.19.0**. 검증: admission-api **415개 중 412 통과·3 skip·0 실패**, 보안 선별 **233 통과·skip 0**, 지원자 1280/320 각 29화면·콘솔 1280/320 각 20화면 문제 0, 키보드 완주 118키 문제 0. 접근성 순회의 **증적 열람 화면이 지금까지 늘 건너뛰어지던 시험 결함**(사유를 헤더로 보내 400 — API 는 질의 `reason`)을 고쳐 이제 실제로 돈다.
> **DB 제약 검증은 이제 24종**(`verify-constraints.sql` — #17 앱 역할 권한 규칙에 `privacy_request`·`fee_refund_request` 를 넣었다. 넣지 않으면 열 단위 UPDATE·DELETE 없음이 규칙 밖이라 CI 의 이 검사가 실패한다. **새 표를 만들면 #17 에 그 표의 권한 규칙을 같이 넣는다**. #24 결정 한 번·금액 상한·내용 고정·앱 삭제 불가). `ci-pg` 에서 24종 PASS.
> **2026-10-04 Codex 세션 — 남은 화면 캡처 완료.** 개발 모드 지원자·장애 22장, 콘솔 12장과 로그인 28~34번을 최신 코드로 다시 찍고 새 36~42번(원서 권리·반환 카드, 지원자 요청·신청, 콘솔 큐·상세)을 추가했다. 총 42장. 새 개발 모드 캡처의 렌더링 문구 위반 0건, 전체 빌드·`check:ui-copy` 통과. 캡처 자동화의 대조 예외 원서 필수 동의 누락과 증적 입력 옛 라벨도 고쳤다. 로그인 35번은 화면 코드가 바뀌지 않은 2026-10-03 통과본이다.
> **2026-10-04 Codex 세션 — Pilot 외부 실행 패키지 준비.** 노션 기술설계서 §14·16·19와 운영 리스크 원본을 다시 읽어 SEV1~3 런북·D-180~D+30 9구간·War-room 5개 상황·영향평가 사전판정·Compliance 10개 영역·필수 시험 18종·Sandbox→Shadow→제한 Pilot을 [문서 18](18-pilot-execution-package.md)로 묶었다. `deploy/pilot/pilot-readiness.example.yaml`과 `npm run ops:pilot-readiness`가 기관 승인·실행 증적, 실행 환경·시각·시험 skip 수가 빠지면 실패한다. 단위 시험 3개 통과·skip 0. 빈 양식은 의도대로 0/9·0/18·0/10·0/3과 종료 코드 1. **실제 대학 승인·훈련은 하지 않아 전체 125/146·남은 21개는 그대로다.**
> **같은 세션 — M4 외부 부하 실행 준비.** 노션 §08 원본을 다시 확인하고 바이트 고정 첨부 `k6-admission.js`는 건드리지 않았다. 별도 `k6-acceptance.js`에 합성 사용자별 OIDC 토큰·원서, 500/1,500/3,000 VU+1,000 RPS·70% Failover·6시간 Soak, 장시간 토큰 갱신과 승인/HTTPS 안전장치를 넣었다. `ops:load-acceptance`는 k6 threshold·버린 iteration과 DB 정합성 7개·writer epoch를 함께 판정한다. 단위 3개 pass·skip 0, k6 6시간 프로필 inspect 통과, `ci-pg` 읽기 전용 통합 판정 통과. **원격 부하·Failover·Soak는 실행하지 않아 T-M4-30~32·36·41은 미완료다.** 실행법은 [tests/load/README](../tests/load/README.md).
> **D-90 OPEN** — §08의 전체 지원 30,000건과 Finalize 150 TPS×5분+300 TPS×60초(63,000요청)가 충돌한다. 기존 첨부는 한 원서에 새 멱등 키를 반복해 첫 1건 뒤의 이미 접수된 응답을 실제 처리량처럼 잰다. 외부 실행 전에 첫 Finalize/멱등 replay의 분모·지속시간을 확정해야 하며, 그 전에는 Finalize p95를 완료로 세지 않는다([대장 D-90](02-spec-discrepancy-register.md), [노션 변경안](06-notion-changeset.md)).
> **같은 세션 — 외부 PostgreSQL HA 사전 점검 준비.** `ops:ha-preflight`가 Primary/Standby에 읽기 전용으로 접속해 역할·동기 streaming·같은 계보/다른 주소·WAL 지연·archive·운영 writer token/epoch 13개를 본다. 단위 3개 pass·skip 0. 독립 Primary 둘을 넣은 로컬 음성 대조는 의도대로 7/13만 통과하고 6개를 실패했다. zone·원격 백업·실 PITR·실 RTO/RPO·DNS/Edge/Reconciliation은 사람 증적으로 남긴다. **실 HA에서는 실행하지 않아 T-M4-06·T-M5-60·61·64는 미완료다.** [문서 14](14-operations-automation.md)
> **같은 세션 — 실 PG Sandbox 수용 게이트 준비.** `ops:pg-sandbox-acceptance`가 실제 `pg-sandbox`와 대학·PG 승인, 결제·콜백·복구 9종, 정산 일치·불일치 5종, 건너뜀 0건, 미처리 예외·중복 승인·승인 후 미접수 0건을 요구한다. Mock PG와 거래/가맹점 원문은 거절하고 식별자 집합 SHA-256·통제된 증적 참조만 남긴다. 단위 3개 pass·fail 0·skip 0, 빈 예시는 의도대로 결제 0/9·정산 0/5와 종료 코드 1. **실 PG 계약·어댑터·실행은 없어 T-M6-04·05는 미완료다.** [문서 18 §8.1](18-pilot-execution-package.md#81-t-m6-0405--실-pg-sandbox-수용-게이트)
> **같은 세션 — CSP Edge·노드 장애 수용 게이트 준비.** `ops:edge-failover-acceptance`가 실제 Edge가 있는 다중 zone CSP staging만 받고, 안전 메서드와 멱등 키 쓰기의 제한 재시도·능동 헬스체크·계획 정비/강제 노드 손실을 판정한다. 강제 손실의 실제 Edge 재시도 1건 이상과 사용자 체감 실패·중복 쓰기·중복 접수·이중 승인·미복구 이벤트 공백 0건을 함께 요구한다. 단위 3개 pass·fail 0·skip 0, 빈 예시는 0/2로 의도대로 실패했다. **실 CSP 실행은 없어 T-M4-39는 🟡 그대로다.** [문서 18 §8.2](18-pilot-execution-package.md#82-t-m4-39--csp-edge노드-장애-수용-게이트)
> **같은 세션 — 외부 PITR·DR 수용 게이트 준비.** `ops:dr-acceptance`가 실제 CSP DR staging, 서로 다른 Primary/Standby zone과 제3 장애영역 백업, HA 사전 점검 13/13, 목표 시각 PITR·복구본 검증, 부하 중 Failover·Failback·사후 대조를 요구한다. 사건 시각으로 RTO/RPO를 다시 계산해 900초/60초를 넘으면 실패하고 Writer epoch +1·옛 Writer 거절·DNS/Edge 전환과 유실/중복/공백/예외 0을 확인한다. 단위 3개 pass·fail 0·skip 0, 빈 예시는 의도대로 실패했다. **실 DR은 실행하지 않아 T-M4-06·T-M5-60·61·64는 미완료다.** [문서 18 §8.3](18-pilot-execution-package.md#83-t-m4-06t-m5-606164--pitrdr-수용-게이트)
> **같은 세션 — 외부 M Profile 부하 캠페인 종료 게이트 준비.** 개별 `ops:load-acceptance` 결과에 환경·승인·실행시간을 보존하고, `ops:load-campaign-acceptance`가 500·1,500·3,000 VU+1,000 RPS·70% Failover·6시간 Soak 5개를 같은 승인 환경으로 묶는다. 요구 인원·최소 실행시간·Failover Writer 세대와 API 메모리/DB 연결/Pool 대기/Outbox/중앙 지연 추세를 판정한다. 기존 개별 단위 3개 + 캠페인 단위 3개 pass·fail 0·skip 0, 빈 예시는 0/5·0/5로 실패했다. **실 CSP 부하는 실행하지 않아 T-M4-30·31·32·36·41은 미완료다. D-90 Finalize TPS는 제외했다.** [문서 18 §8.4](18-pilot-execution-package.md#84-t-m4-3031323641--m-profile-부하-캠페인-종료-게이트)
> **같은 세션 — 실물 브라우저·수동 접근성 수용 게이트 준비.** `ops:manual-accessibility-acceptance`가 실물 Windows Firefox·iPhone Safari의 지원자 접수/OIDC/세션/키보드/확대/업로드 12칸과 데스크톱·모바일 스크린리더/200% 확대/음성 입력 4종을 건너뜀 없이 요구한다. 에뮬레이션·차단/중대 결함·미승인을 거절한다. 단위 3개 pass·fail 0·skip 0, 빈 예시는 0/2·0/12·0/4로 실패했다. **사람의 실제 실행은 없어 T-M5-47은 🟡, T-M5-48은 미완료다.** [문서 09](09-accessibility.md#실물수동-검사-실행-양식-2026-10-04)
> **같은 세션 — 제출용 개발보고서 정오표 PDF 준비.** 원본 제출 PDF는 저장소에 없어 직접 수정하지 않았다. `scripts/docs/render-submission-errata.py`로 기술 스택·지원자 6단계·조건부 결제 후 접수 설명을 담은 A4 1쪽 [정오표](../output/pdf/wonseoro-submission-errata.pdf)를 만들고 150dpi 렌더링에서 한글·표·여백을 확인했다. JavaScript·암호화 없음. **제출처 반영·접수 확인 전이라 T-M0-08은 미완료다.** [문서 07](07-submission-errata.md)
> **2026-10-04 Codex 외부 실증 준비 세션 요약.** 커밋 `58ebd0e` Pilot 운영 패키지 → `acebe74` 외부 부하 프로필/DB 게이트(D-90 등록) → `86f70eb` HA 사전 점검 → `9efbe72` 실 PG → `a8093f2` Edge → `d8cdbd1` PITR·DR → `6b92ac5` 부하 캠페인 → `0443e35` 수동 접근성 → `21b3602` 제출용 정오표 PDF 순서다. 외부/사람 실행은 하지 않았으므로 **125/146·남은 21개는 그대로**다. 8개 게이트 단위시험은 `npm run test:ops:external-gates`, 계약은 `npm run check:contracts`로 다시 확인한다.
> **마감 검증** — 외부 게이트 단위시험 **24개 통과·실패 0·건너뜀 0**, OpenAPI 1.19.0 73개 operation·CloudEvents 4종 계약 검사 통과, `git diff --check` 통과. 빈 양식 실패는 의도된 음성 대조다. 사용량은 마지막 기능 작업을 멈춘 시점에 5시간 창 잔여 9%·주간 잔여 39%였고, 이후에는 인계 문서와 커밋 검증만 수행했다.
> **세션 마감 상태(2026-10-04, ChatGPT/Codex 로 넘김) — 넘겨받는 쪽이 먼저 볼 것**
> 1. **push 안 함** — 이 문서의 최종 인계 커밋까지 로컬 `main`은 `origin/main`보다 17커밋 앞이다. 외부 실증 준비 9개는 바로 위 세션 요약 순서이고 마지막 1개가 게이트 전체 검증·인계 갱신이다. 그 앞 7개는 G-12 `ab546ff`·G-13 `63c028d`·G-9 `e9af8e9`·G-5 `9d6745e`·DB 제약 `0b9a151`·인계 정리 `e0a2f96`·화면 캡처 `f0045fd`다. 모두 작성자·커밋한 사람 `ryan-ahn-song <ryansong0805@gmail.com>`, 공동저자 줄 없음(`git log origin/main..HEAD` 로 확인). push 는 사용자 몫
> 2. **개발 시드가 바뀌었다** — 장애인 증명서(`DISABILITY_CERT`·동의 `SENSITIVE_HEALTH`)·여권번호(`passportNumber`·동의 `PASSPORT_COLLECTION`)·지원 제한 안내(`notices.applicationRules`). `ci-pg`·`ui-shots-pg` 에는 다시 적용했다. **kind·로컬 compose DB 는 다음 시험 전에 `seed-dev.sql` 재적용**(새 마이그레이션 0009·0010 도 — `npm run db:migrate`)
> 3. **옛 보존 항목 이름 거절** — `APPLICANT_PII`·`DOCUMENT_FILE` 은 접수·미접수 4항목으로 나뉘어 설정 검사가 옛 이름을 "알 수 없는 데이터 종류" 로 거절한다. 운영 중인 대학 설정이 아직 없어 이전(별칭) 경로는 두지 않았다(대장 D-87 ⑤)
> 4. **이 PC 는 PowerShell PATH 에 git 이 없다** — 위 「이 PC 환경 메모」의 GitHub Desktop git 경로를 쓴다
> 5. **처음 읽을 곳** — 이 문서 맨 위(이 블록)와 아래 「바로 다음 할 일」. 노션 반영은 [06-notion-changeset.md](06-notion-changeset.md)(OpenAPI 1.19.0 바이트·SHA-256 포함)
> 서버·DB: `ci-pg`(:5499, univ_a 0001~0011 + central 0001~0005)·`ui-shots-pg`(:5497, 0001~0011) 는 실행 중일 수 있다(2026-10-05 기준). 미리보기 서버는 모두 껐다.
> **이어서 할 일** — 로컬 AI 몫과 화면 캡처, 외부 작업 실행 패키지까지 끝났다. 대학/CSP/PG가 정해지면 [문서 18](18-pilot-execution-package.md) 순서로 대학별 YAML을 만들어 B·C 실증을 진행한다. 실 PG는 `deploy/pilot/pg-sandbox-acceptance.example.yaml` 사본을 채워 `npm run ops:pg-sandbox-acceptance -- --file=...`로 판정한다. 그 전에는 외부·사람 몫(03 B·C)과 노션 반영(06)만 남는다.
> **Pilot 지원 도구 기록** — T-M6-01(구조화 전형 Schema 온보딩)·T-M6-06(대학 장애 원장·공개 상태·배너)·T-M6-07(상담 확인번호·허용 목록 응답·자동 증적번호, 새 역할 `support-agent`) 상세는 [17-pilot-support-tools.md](17-pilot-support-tools.md).
> 화면 작업은 접근성 시험을 다시 돌리고 `check:ui-copy` 를 지킨다(§2). 이번 작업의 임시 웹/API 프로세스는 모두 종료했다. 화면 시험용 PostgreSQL 컨테이너 `ui-shots-pg`는 실행 중일 수 있다.
> 대학 DB 마이그레이션은 **0001~0011**(0009 정보주체 권리 요청 D-84 · 0010 전형료 반환 신청 D-89 · 0011 권한 변경 기록 D-91), 중앙은 **0001~0005** 다(`infra/db/README.md`). 대학 API 전체 시험은 실 DB에서 **437개 중 434 통과·3 skip·0 실패**(2026-10-05), 중앙 API 41개 통과. DB 제약 검증은 **25종**.
> 같은 폴더에서 다른 세션이 일했다(`apps/admission-api/.dist-flaky/` — 무시 목록에 넣었다). 커밋 전 `git status` 로 남의 파일을 섞지 않는다.
> 이 저장소는 지금까지 한 AI 도구로 개발했다. 다른 도구(또는 사람)가 이어받을 때
> **도구 설정 파일에만 있던 규칙**과 **문서 여러 곳에 흩어진 다음 할 일**을 여기 한 장에 모았다.
> 세부는 링크를 따라간다. 이 문서와 다른 문서가 어긋나면 **다른 문서가 맞고, 이 문서를 고친다.**

---

## 0. 새 환경에서 시작하기 — 다른 컴퓨터·다른 AI 도구

이 문서의 §3 은 처음 개발한 Windows PC 기준이다(C 드라이브 용량, `E:\DockerData` 경로, Claude 도구의 heredoc 함정). 다른 컴퓨터에서는 그 항목을 무시하고 아래를 따른다.

### 필요한 도구와, 없을 때 못 하는 것

| 도구 | 쓰는 곳 | 없으면 |
|---|---|---|
| Node 22.12 이상(`.nvmrc`) · npm · 인터넷 | 설치·빌드·모든 시험 | 시작할 수 없다 |
| Docker(또는 PostgreSQL 16 직접 설치) | DB 통합 시험·DB 제약 검증·보안 선별 시험 | **통합 시험이 실패가 아니라 "건너뜀(skip)" 으로 끝난다** — 통과처럼 보여도 검증이 아니다 |
| Chrome 또는 Chromium | 접근성 시험(`tests/a11y/`)·화면 캡처 | 화면을 고친 뒤 규칙(§2·AGENTS)상 돌려야 하는 접근성 시험을 못 한다 |
| 노션 읽기 | 설계 원본 대조 | 저장소 문서(02 대장·06 변경안·milestones)로 대신한다. 노션 쓰기는 원래 사람 몫이다 |
| kind·Helm·kubectl·Keycloak·Vault·Object Storage | kind 실증·로그인 끝에서 끝·보안 통제 실증 | 지금 다음 작업(G-10·G-8)에는 필요 없다. 그 시험을 다시 돌릴 때만 |

**못 돌린 검증은 반드시 보고한다.** "시험 통과" 라고 쓰기 전에 출력의 `skipped`(건너뜀) 수를 본다. 대학 API 의 정상 건너뜀은 **3개**뿐이다 — 그보다 많으면 DB 가 안 붙은 것이다. DB·브라우저가 없어 못 돌린 시험은 무엇을 못 돌렸는지 문서와 보고에 그대로 적는다.

### 처음 세팅 순서

```bash
npm ci
npm run build -w @wonseoro/contracts -w @wonseoro/server-kit

# CI 재현 DB — 순서의 원본은 .github/workflows/ci.yml 의 integration 잡이다
docker run -d --name ci-pg -e POSTGRES_USER=wonseoro -e POSTGRES_PASSWORD=wonseoro -e POSTGRES_DB=univ_a -p 5499:5432 postgres:16-alpine
export ADMIN=postgresql://wonseoro:wonseoro@localhost:5499
for f in migrations/0001_init.sql migrations/0002_db_roles.sql migrations/0003_field_encryption.sql migrations/0004_break_glass.sql migrations/0005_outbox_archive.sql migrations/0006_writer_fence.sql migrations/0007_service_incident.sql migrations/0008_support_view.sql migrations/0009_privacy_request.sql migrations/0010_fee_refund_request.sql migrations/0011_access_grant_log.sql dev-roles.sql verify-constraints.sql seed-dev.sql ci-seed-deadline.sql; do psql "$ADMIN/univ_a" -v ON_ERROR_STOP=1 -f infra/db/$f; done
psql "$ADMIN/univ_a" -c 'CREATE DATABASE central'
for f in 0001_init.sql 0002_vault.sql 0003_summary_names.sql 0004_vault_encryption.sql 0005_profile_collection_consent.sql; do psql "$ADMIN/central" -v ON_ERROR_STOP=1 -f infra/db/central/$f; done

# 대학 API — 기대값: 437개 중 434 통과·3 건너뜀·0 실패 (2026-10-05, D-91 뒤 — seed-dev.sql 이 최신이어야 민감정보·여권번호·지원 제한 시험 5개가 건너뜀 없이 돈다. WORM 시험 5개는 Object Storage :9000 이 있어야 돈다)
DATABASE_URL=postgresql://kadmission_app:kadmission_app_dev@localhost:5499/univ_a DATABASE_ADMIN_URL=$ADMIN/univ_a UNIVERSITY_ID=UNIV-A npm run test -w @wonseoro/admission-api
# 중앙 API — 기대값: 41개 통과, 건너뜀 0 (중앙 시험은 관리자 계정 주소로 돈다)
DATABASE_URL=$ADMIN/central npm run test -w @wonseoro/central-api
# 정적 검사
npm run check:contracts && npm run check:ui-copy
```

`psql` 이 없으면 `docker exec -i ci-pg psql -U wonseoro -d univ_a -v ON_ERROR_STOP=1 < infra/db/<파일>` 로 같은 일을 한다.

**화면·접근성 시험** — 전용 DB(`bash scripts/screenshots/prepare.sh db`, :5497)와 로컬 서버 다섯을 띄운 뒤 `node tests/a11y/focus-sweep.mjs applicant|admin --width=1280|320`, `node tests/a11y/keyboard-walk.mjs`. 서버별 실행 명령은 `.claude/launch.json` 의 `shots-*` 항목에 있다(Claude 도구 설정 파일이지만 명령은 그대로 쓸 수 있다 — 예: `node --env-file=scripts/screenshots/env/admission.env apps/admission-api/dist/main.js`). 지원자 시험은 `shots-central`·`shots-admission`·`shots-scanner`·`shots-web`·`shots-relay`, 관리자 시험은 `shots-admission`·`shots-admin`.

### 커밋 작성자 규칙 — 반드시 지킨다 (사용자 지침, 2026-10-04)

**GitHub 기여자 그래프에는 팀원 두 사람만 들어간다** — 저장소 주인 **ryan-ahn-song**(`ryansong0805@gmail.com`)과 팀원 **권민준**(GitHub `m1nxun`, `25_kmj0404@dshs.kr`). 그 밖의 사람·AI 는 작성자로도 공동저자로도 들어오면 안 된다. GitHub 는 커밋의 **작성자 이메일**로 기여자를 정하고, `Co-authored-by:` 줄이 있으면 그 사람도 공동 작성자로 센다. push 한 기기·계정은 기여자 집계에 들어가지 않는다.

- **AI 가 하는 작업의 작성자·커밋한 사람은 언제나 `ryan-ahn-song <ryansong0805@gmail.com>`**(GitHub 계정 `ryan-ahn-song`, 옛 이름 UntameDuck — 저장소 주소 `UntameDuck/Wonseoro` 의 UntameDuck 은 조직이다). 권민준의 기존 기여(예: 2026-09-23 `6d5b842` 의 공동저자 줄)는 **그대로 둔다** — 이력을 다시 쓰지 않는다
- 2026-10-04 기준 작성자는 `ryan-ahn-song` 188개, 공동저자 `m1nxun` 1개(`6d5b842`)
- 클론한 뒤 저장소 폴더 안에서 한 번(**`--global` 은 쓰지 않는다** — 남의 기기라면 주인의 다른 작업을 바꾸게 된다):
  ```bash
  git config user.name "ryan-ahn-song"
  git config user.email "ryansong0805@gmail.com"
  git config commit.gpgsign false
  git config core.hooksPath .githooks
  ```
- AI 는 커밋 메시지에 `Co-authored-by:`·`Signed-off-by:` 줄을 넣지 않는다 — AI 도구가 자동으로 붙이는 줄도 지운다. `--author` 로 다른 사람을 지정하지 않는다(권민준이 직접 한 작업을 함께 올릴 때만 그 커밋에 `Co-authored-by: m1nxun <25_kmj0404@dshs.kr>` 를 쓸 수 있다)
- **강제 장치** `.githooks/` — 허용 이메일은 `ryansong0805@gmail.com`·같은 계정의 noreply 주소·`25_kmj0404@dshs.kr` 셋뿐이다. `commit-msg` 는 허용 밖 작성자나 허용 밖 이메일의 공동저자 줄이 있는 커밋을, `pre-push` 는 올라갈 커밋 전부를 다시 보고 어긋나면 push 를 거절한다(GitHub 웹 커밋의 "커밋한 사람" `noreply@github.com` 만 예외 — 기여자로 세지 않는다). 훅은 `core.hooksPath` 를 켜야 돈다 — 끄거나 `--no-verify` 로 건너뛰지 않는다. 팀원이 늘면 저장소 주인이 정한 뒤 두 훅의 `ALLOWED` 와 이 절을 같이 고친다
- push 전 확인: `git log origin/main..HEAD --format='%an <%ae> | %cn <%ce>%n%b---'` — 모든 줄이 위 신원이고 공동저자 줄이 없어야 한다. push 하지 않은 어긋난 커밋은 `git rebase origin/main --exec 'git commit --amend --no-edit --reset-author'` 로 고친다. **이미 push 한 커밋은 강제 push 로 고치지 않고** 주인에게 보고한다
- 보고 끝에 "올린 커밋 N개, 작성자 모두 ryan-ahn-song <ryansong0805@gmail.com>, 공동저자 줄 없음" 을 확인 결과와 함께 적는다

### 작업 방식 (사용자가 정한 것)

- 묻지 말고 최선안으로 결정·진행하고 결과를 보고한다. 작업마다 끝에 문서(HANDOFF·03·대장·06 등)를 갱신한다
- 삭제·전역 설정 변경·되돌리기 어려운 일은 사용자 확인 뒤에. 애매한 지시는 질문으로 읽는다
- 보고·문서·커밋은 한국어, 커밋에 AI 공동저자 줄을 넣지 않는다

## 1. 30초 요약

- **제품**: 원서로(K-Admission) — 대학 입학 원서접수를 대학별 Data Plane 으로 분산하는 플랫폼. 2026 GovTech 공모전 출품작
- **현재**: M0~M3 끝(MVP가 화면에서 접수번호까지 동작), **M4(분산 실증) 21/28 진행 중**. 전체 **125/146** 태스크(✅ 만 셈, 2026-10-04 T-M6-01·06·07 포함). **CI 네 잡과 Security 기본 열한 잡·서명 다섯 잡·admission 실증 잡 모두 초록**(Actions run 36906282615·36906280555). 이번 작업 폴더의 미커밋 변경은 로컬 검증을 마쳤고 원격 CI는 아직 돌리지 않았다
- **완료한 핵심 증명**: 로컬 kind 2클러스터 축소 환경에서 **대학 간 장애 격리 T-M4-42 통과**. A대 전면 정지 중 B대 접수·중앙 반영, A대 복구 후 접수까지 확인
- **최근 완료**: T-M4-07 Peak Mode(ADR-0006) · T-M4-20 전 서비스 계측·로그 상관관계 · T-M4-24 로그 마스킹 강제 · **T-M4-21~23 업무 KPI·대시보드 3종** · **D-50 취소 이벤트 계약 위반 수정** · CI 복구 · **T-M4-40 NAT Adaptive Throttling(ADR-0007)** · 과부하 중 API 프로세스가 죽던 결함 수정 · **T-M4-37 Redis 장애 무영향** · T-M4-39 다중 노드 시험(drain 무중단·노드 장애 때 전체가 멈추던 DB 연결 결함 수정, D-52) · **맡겨진 결정 정리(2026-09-30)** — D-44 ⑦(Pod 당 38)·D-47·D-51(OpenAPI v1.3.0 429)·D-52(ADR-0008)·D-53(ingress-nginx 은퇴) 결정·저장소 반영. §05 runtime 첨부를 차트 렌더링으로 바꿔 CI 가 드리프트를 막는다. **노션 반영은 AI 쓰기가 막혀 [06-notion-changeset.md](06-notion-changeset.md) 로 대기**
- **T-M4-35 ✅** 중앙 2시간 실제 단절 통과 — 원서 24건 처리·DEAD 0·event loss 0·복구 10초 뒤 전량 전송·재시작 0 (`central-outage-realtime-2026-09-30T01-59-27-784Z.json`)
- **미완결 기능 전수 점검 ✅ (2026-09-30, D-55 ~ D-61)** — 정의만 있고 흐름에 이어지지 않던 것·흉내뿐이던 것을 모두 잇거나 이유와 함께 남겼다: 원서 상태머신·한 원서 한 결제·PG 정산 대조, §A9 시각(노드–DB offset·DB 커밋 시각), 공통원서 지원자 API·화면, 설정 기반 서류·항목·Config Linter, §04 심장박동, ClamAV 어댑터, 운영 콘솔 초안·보존기간, 계약 검사 스크립트. OpenAPI **v1.4.0**. 정리표는 [04-production-readiness.md §7](04-production-readiness.md#7-흉내미연결-전수-점검-2026-09-30). **kind 에는 아직 이 코드의 이미지를 올리지 않았다** — 다음 kind 작업 때 이미지 재빌드·`seed-dev.sql` 재적용
- **화면 캡처 43장 (2026-10-05 최신 — 43 권한 변경 기록 추가)** — 개발 모드 지원자·장애 22장, 관리자 콘솔 13장, 로그인 모드 8장을 [docs/screenshots/](screenshots/README.md)에 두었다. 전용 DB(`ui-shots-pg` :5497)와 전용 포트로 찍어 kind 시험과 섞이지 않는다. 다시 찍는 스크립트는 `scripts/screenshots/`.
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
- **T-M5-27 ✅ (2026-10-02)** — ZAP 2.17.0 고정 digest로 OpenAPI 81개 URL을 실제 대학 API·PostgreSQL에 active scan했다. 첫 실행에서 잘못된 `cycleId`·`limit`가 DB까지 내려가 500이 되는 문제, `/meta/time` 무인자 500, `nosniff` 누락을 찾아 고쳤다. 같은 조건 재실행은 로컬·원격 모두 **WARN 0·High 0·PASS 118**이다(Actions run 36902632192·36902632233). 로컬 보고서는 `E:\DockerData\tools\zap-2.17.0\reports`에 있다
- **T-M5-28 ✅ (2026-10-02)** — 릴리스/수동 실행이 운영 이미지 5종을 GHCR에 발행하고 registry digest를 Cosign 3.0.6 GitHub OIDC 신원으로 키리스 서명한다. 같은 잡이 정확한 워크플로 신원과 OIDC 발급자로 즉시 검증하고 이미지별 증적을 90일 보관한다. 실제 5종 모두 통과했다(Actions run 36903506905). 로컬 증적은 `E:\DockerData\tools\cosign-3.0.6\run-36903506905`
- **T-M5-29 ✅ (2026-10-02)** — 운영 `ClusterImagePolicy`는 GHCR 원서로 이미지에 대해 이 저장소 `security.yml@refs/tags/*`의 GitHub OIDC 서명만 강제한다. 후속 잡은 임시 kind·Policy Controller를 띄워 서명된 admission-api digest 허용과 별도 미서명 scratch digest 거부를 server dry-run으로 실증한다 — 미서명은 `policy.sigstore.dev` webhook 이 첫 확인에서 거부, 서명 digest 는 통과(Actions run 36906282615). 첫 실행의 "미서명 통과"는 kubectl dry-run 값을 띄어 써 webhook 이 안 불린 시험 결함이었다(고치고 정적 검사로 막음)
- **인증 단계 1·2 ✅ (2026-10-03)** — 로컬 Keycloak 26.8.0(`docker compose … --profile auth up -d keycloak`, :18080, 렐름 `infra/auth/`): 담당자 비밀번호+TOTP(`acr=mfa`, 5분 뒤 재인증)·역할 6종, 지원자 렐름. `server-kit` `OidcVerifier`·`JwksCache` — 발급자를 멈춘 채 검증 지속·스냅숏으로 재기동(`test:auth:issuer` 24·`test:auth:verifier` 11·단위 17). [12 §6](12-authentication-plan.md)
- **인증 단계 3 ✅ (2026-10-03)** — 대학 API `AUTH_MODE=oidc`: 요청 한도보다 먼저 토큰 검증(`app.setup.ts`), 지원자 첫 로그인 등록(개인정보 없음), 운영 API 경로마다 계약 범위 → 역할(`@AdminScope`, **D-64**)·비밀번호+OTP·민감 동작 8개 5분 재인증(RFC 9470), 2인 승인 신원 = 토큰의 담당자. 시험: 계약 대조 8·역할 표 6·HTTP 9(BOLA·수직 권한·발급자 정지)·실제 Keycloak 끝에서 끝까지 19(`test:auth:api`). [12 §6](12-authentication-plan.md)
- **인증 단계 4 ✅ (2026-10-03)** — 중앙 API `AUTH_MODE=oidc`: 공통원서·"내 원서" 가 지원자 렐름 토큰의 sub 를 가명 토큰으로 쓴다(대학과 같은 sub). 실제 로그인 한 번으로 중앙에 쓴 공통원서가 대학 원서에 들어오는 것까지 확인(`test:auth:central` 9). 보안 선별 시험 173개
- **인증 단계 5 ✅ (2026-10-03)** — 운영 콘솔 관리자 로그인(`ADMIN_AUTH_MODE=oidc`): 콘솔 서버가 PKCE 로그인·토큰을 AES-GCM 봉인 HttpOnly 쿠키에만·만료 전 갱신, 재인증 안내 → `max_age=0` 재로그인, 로그아웃. 로그인 모드에서는 개발용 담당자 입력이 없다. 미리보기 `auth-admin`·`auth-admission`(env `scripts/auth/env/`). `test:auth:console` 21, 접근성 `focus-sweep admin-oidc`. 계약 **1.7.0**(모집·전형·모집단위 공개, D-65)
- **⚠️ D-66 (2026-10-03 수정)** — 10-02 NestJS 11 업그레이드 뒤 CORS 기본 메서드가 GET·HEAD·POST 로 줄어 **브라우저의 원서 저장(PATCH)·공통원서 저장(PUT)·서류 삭제(DELETE)가 막혀 있었다**. CI·DAST 는 사전 요청을 안 해 못 잡았다. 두 API 에 메서드를 적고 사전 요청 시험(`app.setup.test.ts`)을 두었다
- **인증 단계 6 ✅ (2026-10-03)** — 지원자 화면 본인확인(`NEXT_PUBLIC_AUTH_MODE=oidc`, 공개 클라이언트 + PKCE, 토큰은 탭 sessionStorage). 세션 만료 경고는 그대로 두고 연장=토큰 갱신, 끝나면 갱신 토큰 폐기로 발급자 세션까지 끝냄. **위험 차단을 본인확인 다시 하기로 해제**(ADR-0009). 미리보기 `auth-web`(:3001)·`auth-central`(:3112). 접근성 `focus-sweep applicant-oidc`, 보안 선별 시험 175
- **인증 단계 7 ✅ (2026-10-03)** — 발급자 정지 실증 `npm run test:auth:offline`(약 7분, Keycloak 컨테이너를 직접 멈췄다 다시 띄운다 — 시험 지원자는 관리 API 로 만들고 끝나면 지운다). 액세스 토큰(5분)이 끝나면 갱신할 길이 없어 **단절 유예**를 두었다(D-67): 발급자에 닿지 않는 동안만·만료 2시간 안·마지막 접촉 뒤 만료된 **지원자** 토큰만(`OIDC_APPLICANT_OUTAGE_GRACE_MS`, 대학·중앙 API). 화면은 갱신이 안 되면 쓰던 토큰을 계속 보낸다. T-M3-06 ✅
- **인증 단계 8 ✅ (2026-10-03)** — 차트 역할 6종(security-auditor 추가, break-glass 는 Role 만·평소 바인딩 없음·켤 때 끝나는 시각·사유 필수, admission-admin 은 Kubernetes 권한 0). sre 의 재시작(Deployment patch)이 Secret 참조를 넣는 길이라 **플랫폼 승인 정책** `deploy/platform/rbac/sre-operator-guard.yaml` 로 replicas·재시작 표시만 허용(D-68, kind-univ-a 에 적용해 둠). `npm run test:auth:k8s`(kind, 1분 안쪽 — 시험 네임스페이스를 만들고 지운다). 차트 RBAC 을 고치면 `node scripts/render-runtime-attachment.mjs` 와 06 changeset 해시도
- **인증 단계 9 ✅ (2026-10-03) — 인증 T-M5-02·10 끝** — 로그인 서버(Keycloak) 화면도 접근성 시험(`focus-sweep issuer`): 기본 테마 결함 22건을 **원서로 로그인 테마**(`infra/auth/themes/wonseoro` — 포커스 표시·오류 연결·라벨·320px 말풍선, compose 가 붙이고 렐름 `loginTheme`)로 고침. 접근성 전체 다시(모두 0건), 화면 **35장**(개발 27장 다시 + 로그인 모드 28~35, `capture.mjs auth`), **토큰 붙인 ZAP DAST** — 시험 발급자(`scripts/security/dast-issuer.mjs`)·대학 API oidc·ZAP 시작 훅(`zap-auth-hook.py`)이 경로별 토큰, 인증 도달 확인(`check-dast-auth.mjs`). 로컬은 `node scripts/security/dast-local.mjs`(약 8분). **함정** — 같은 담당자 계정으로 1분 안에 로그인 시험을 연달아 돌리면 Keycloak 이 일회용 번호를 재사용으로 거절한다(`test:auth:issuer`·`api`·`console` 은 1분 간격으로). 재인증(`max_age=0`)은 첫 로그인과 같은 초 안이면 다시 묻지 않는다(시험은 1초 넘게 기다린다)
- **보안 통제 착수 (2026-10-03, [13](13-security-controls-plan.md)) — 단계 1 ✅ 서비스 간 상호 TLS** — 계약이 mutualTLS 를 요구한 내부 경로 여섯이 **인증 없이 열려 있었다**(D-69 — 다른 대학 이름의 이벤트·남의 공통원서·서류 검사 위조). 이제 `INTERNAL_AUTH=mtls`: API·중앙이 HTTPS, `/internal/**` 은 워크로드 인증서(SAN URI `spiffe://wonseoro/university/<대학>/<워크로드>`)만, 요청의 대학 = 인증서의 대학. 개발 서버·단위 시험은 `none`(기본, 운영은 기동 거부). 개발 PKI `node scripts/pki/dev-pki.mjs`(openssl, `.cache/pki`). 실증 `npm run test:security:mtls`(CI 재현 DB, 약 40초). 차트 `internalTls`(운영 필수, 로컬 kind 는 단계 4 까지 끔)
- **보안 통제 단계 2 ✅ (2026-10-03)** — 출구 허용 목록(`server-kit/src/egress.ts`): 서비스마다 config 의 `configureEgress([의존 서비스 URL])` 로 그 호스트만, 연결 순간 메타데이터·링크 로컬 주소 거절(운영은 루프백도). **새 외부 의존을 붙이면 그 URL 을 configureEgress 에 넣거나 `EGRESS_ALLOWLIST` 에** — 안 넣으면 요청이 `EgressDenied` 로 막힌다. 시험 코드가 가짜 서버를 부르면 `configureEgress([가짜 URL])` 또는 `new InternalHttpClient(null, new EgressPolicy({ allow: ['localhost'], allowLoopback: true }))`. NetworkPolicy 행렬 `npm run test:security:netpol`(kind 두 대학·로컬 DB/Redis 컨테이너 — 약 1분)
- **보안 통제 단계 3 ✅ (2026-10-03)** — 필드 암호화(D-70, `server-kit/src/field-crypto.ts`). 원서 항목 값 전부와 중앙 공통원서를 봉투 암호화(레코드별 DEK·KEK `FIELD_KEK_KEYS`). **DB 를 새로 만들 때 대학 `infra/db/migrations/0003_field_encryption.sql`·중앙 `infra/db/central/0004_vault_encryption.sql` 을 꼭 적용**(CI·`db:migrate`·캡처·DAST 목록에는 넣었다. **로컬 compose DB·kind 가 보는 DB 에는 아직 안 했다** — 다음에 compose 를 켜면 `npm run db:migrate`·`db:migrate:central`). 시험이 `application_field_value.value_json` 을 직접 읽으면 이제 NULL 이다 — 앱의 `loadFields` 로 읽는다. KEK 교체·옛 평문 이전은 `node apps/*/dist/tools/field-keys.js status|encrypt-legacy|rewrap`
- **보안 통제 단계 4 ✅ (2026-10-03)** — Vault(`server-kit/src/vault.ts`). 개발 Vault: `docker compose -f infra/compose/docker-compose.dev.yml --profile vault up -d vault` → `node scripts/vault/dev-vault.mjs`(개발 모드라 **Vault 를 재시작하면 비어 있다** — 다시 구성). 실증 `npm run test:security:vault`(CI 재현 DB :5499 필요, Vault 컨테이너가 `host.docker.internal:5499` 로 DB 에 닿는다). 앱은 환경변수로 켠다 — `FIELD_KEK_PROVIDER=vault`·`DATABASE_CREDENTIALS=vault`·`MTLS_ISSUER=vault`(+`VAULT_ADDR`·로그인 수단). 끄면(기본) 지금까지와 같다. 첨부 정책의 PKI 역할이 대학 단위라 워크로드별로 좁혔다(D-71)
- **보안 통제 단계 5 ✅ (2026-10-03)** — break-glass(D-72). 차트는 끝나는 시각 전에만 바인딩을 렌더링하고(12시간 상한), 켜면 매분 회수 CronJob 이 경보 이벤트를 내고 시각이 지나면 지운다. DB 비상 접속은 Vault `database/creds/break-glass-<대학>`(15분)만 — **대학 DB 마이그레이션 `0004_break_glass.sql` 도 적용 목록에 넣었다**(로컬 compose·kind DB 는 아직). 시험 `npm run test:security:break-glass`(kind-univ-a, 시험 네임스페이스를 만들고 지운다)
- **보안 통제 단계 6 ✅ — 보안 통제 끝 (2026-10-03)** — 실 clamd(D-73). `docker compose -f infra/compose/docker-compose.dev.yml --profile av up -d clamav`(처음엔 서명 DB 를 받느라 몇 분, 메모리 약 1.3GB — kind 두 개와 함께 켜도 됐다) → `npm run test:security:clamd`. 실 clamd 에서 워커가 멈추던 결함을 고쳤고 PDF 능동 콘텐츠를 거절한다
- **T-M4-10 ✅ (2026-10-03)** — Outbox 보관(D-74, `0005_outbox_archive.sql`, `common/outbox/outbox-archive.ts`). 대학 DB 마이그레이션은 이제 **0001~0005** 다(적용 목록은 `infra/db/README.md`). admission-api 전체 실행에서 `oidc-auth.integration.test` 의 "계약의 공개 경로는 토큰 없이…" 가 가끔 실패하던 것은 **고쳤다(2026-10-03)** — 모집을 지정하지 않은 `GET /meta/time` 은 가장 최근에 연 OPEN 모집을 고르는데, 동시에 도는 `config-governance`·`deadline-extension` 시험이 마감 정책 없는 OPEN 모집을 잠시 만들면 그 모집이 뽑혀 503 이 났다(정책 없는 OPEN 모집을 일부러 넣어 단독 실행으로 재현). 시험이 개발 시드 모집을 지정한다. 같은 조사에서 `audit-worm.integration.test` 의 "이어서 내보내면 0건" 도 가끔 실패했다(다른 시험의 감사 기록이 그사이 60초를 넘겨 새 조각으로 나감) — 0건 대신 앞 조각과 겹치지 않는지를 본다. CI 재현 DB 전체 실행: 고치기 전 6회 중 2회 실패(oidc 1·audit-worm 2) → 고친 뒤 5회 모두 통과 377·실패 0·건너뜀 3
- **T-M5-65 ✅ (2026-10-03)** — 만료 경보([14](14-operations-automation.md)). 지표 `credential_expiry_timestamp_seconds`, 규칙 `deploy/platform/observability/expiry-rules.yaml`(Prometheus 에 `-f expiry-rules.yaml` 로 더한다 — kind 관측 스택에는 아직 안 올렸다)
- **T-M3-03 ✅ (2026-10-03, D-83 재검증 2026-10-04)** — 감사 기록 WORM(D-75, `modules/audit/audit-worm.ts`). 운영은 `AUDIT_WORM_BUCKET` 필수(Object Lock 버킷). 로컬 시험은 S3 호환 Object Storage(:9000, `docker compose … up -d object-storage`)가 있어야 돈다 — 시험마다 `audit-worm-it-<시각>` 버킷이 남는다(보관 1일, 잠긴 조각이 있어 바로 못 지운다). RustFS 교체 뒤 3개 시험이 skip 없이 통과했고 COMPLIANCE 잠긴 버전 삭제·보관 단축이 실제로 거절됐다
- **T-M5-62 ✅ (2026-10-03)** — 복구 검증 `npm run ops:restore-verify`(기본 원본 CI 재현 DB :5499, 새 컨테이너 :5498 에 복구하고 지운다), 매달 `.github/workflows/restore-verify.yml`. 시험 `breakGlass` 정리가 남기던 고아 데이터 키를 치우게 고쳤다
- **T-M5-63 ✅ (2026-10-03)** — Writer fencing(D-76, `0006_writer_fence.sql`). 이후 T-M6-06의 `0007_service_incident.sql`까지 추가되어 대학 DB 마이그레이션은 **0001~0007**. 앱은 `WRITER_EPOCH` 가 있으면 트랜잭션마다 세대를 넘긴다(없으면 넘기지 않는다 — 개발). **시험 코드가 원서 없는 감사 기록(운영자 체인)을 만들면 동시에 도는 체인 검사 시험이 깨진다** — 시험은 자기 원서에 붙인다
- **T-M6-03 ✅ (2026-10-03)** — CSP 사전 점검 `npm run ops:csp-preflight -- --context=<컨텍스트>`(점검용 네임스페이스를 만들고 지운다, 약 1분 반)
- **T-M6-11 ✅ (2026-10-03)** — 개인정보 처리흐름도 [15](15-privacy-data-flow.md)(흐름도·저장소별 보호·보존·밖으로 나가는 곳). 코드가 바뀌면 같이 고친다
- **T-M6-14 ✅ (2026-10-03)** — 대학 온보딩 문서 [16](16-university-onboarding.md)(입학처 설정·정보화부서 인프라·계정·접수 전 확인 순서)
- **T-M6-02 ✅ (2026-10-03)** — Config 호환 시험(D-77, `modules/config/config-compat.ts`): 적용 직전 진행 중 원서를 새 양식으로 검사해 깨지면 거절
- **T-M6-07 ✅ (2026-10-04, D-79)** — 개인정보 최소 상담 조회. 상담원은 접수번호 또는 **상담 확인번호**(`application.support_code`, 원서마다 DB 가 만드는 10자, 지원자는 검토·접수 완료·장애 안내 화면에서 `XXXXX-XXXXX` 로 본다)로만 찾는다. 응답은 허용 목록(`SupportView`) — 원서 내용·서류·연락처·내부 식별자 없음. 조회마다 증적번호 `SR-YYYYMMDD-XXXXXX` 와 그 순간 응답·SHA-256 을 추가 전용 `support_lookup`(마이그레이션 0008)에, 원서 감사 체인에 `SUPPORT_LOOKUP`. 새 역할 `support-agent`(렐름 시험 계정 `support` — **렐름 파일만 고쳤다. 로컬 Keycloak 에 계정을 만들려면 `up -d --force-recreate keycloak`**), 범위 `support`(support-agent·admission-admin, Step-up 없음). 콘솔 `/support`. OpenAPI 1.9.0. **새 운영 경로를 더하면 `oidc-routes.test` 의 Step-up 목록과 `oidc-auth.integration` 역할 표를 같이 고친다**
- **G-1 ✅ (2026-10-04)** — 시드 학생부종합전형의 위법 「자기소개」 필수 문항을 「학적 변동 사항」(`academicNote`)으로 바꿨다. 설정 검사가 자기소개서류 항목을 경고한다. **원서 항목 코드가 `selfIntro` → `academicNote` 로 바뀌었다** — 시험·부하 스크립트(tests/m4·auth·a11y·캡처)는 따라 바꿨다. **kind·로컬 compose DB 의 활성 설정은 아직 옛 시드다** — 다음에 kind 시험을 돌리기 전에 `seed-dev.sql` 을 다시 적용한다(안 하면 새 스크립트가 보낸 `academicNote` 를 옛 양식이 모르는 항목으로 거절한다). `ci-pg`·`ui-shots-pg` 에는 적용했다
- **G-4·G-6 ✅ (2026-10-04, D-80)** — 대학 설정에 지원자 고지 `notices`(처리방침·위탁 주소 https·보호책임자·문의처·전형료 반환 안내)를 두고, 모든 지원자 화면 바닥글과 검토·결제·접수증에 보인다. 공개 모집 응답에 실린다(OpenAPI 1.10.0). 빠지면 설정 검사 경고, 형식이 틀리면 거절. 시드 문안은 예시 — 대학 승인 문안은 대학 몫. 화면 캡처는 지원자 01~14 만 다시 찍었다(DB 를 `prepare.sh db`·`policy` 로 다시 만들었다 — `ui-shots-pg` 의 앞선 시험 데이터는 없다)
- **G-2·G-11 ✅ (2026-10-04, D-81)** — 원서 동의. 문안은 전형 설정 `consents`(2인 승인), 원서 1단계 맨 위 동의 칸, 동의는 `consent_record`(원서·코드·판·문안 해시) + 감사 `CONSENT_RECORDED`. 필수가 빠지면 최종 검증 오류(`/consents/<코드>`)·결제 전 확인 거절. `PUT /api/v1/applications/{id}/consents` 또는 원서 만들 때 `consents`(OpenAPI 1.11.0). **결제·접수까지 가는 시험·스크립트는 동의가 있어야 한다** — 통합 시험은 `test-support/consents.ts` 의 `grantActiveConsents`, kind 부하·auth 스크립트는 만들 때 `consents: ['APPLICATION_COLLECTION', 'SCHOOL_RECORD_PROVISION']` 를 보낸다(시드 코드 — kind DB 는 다음 시험 전에 `seed-dev.sql` 재적용). `breakGlass` 정리가 고아 `consent_record` 도 지운다
- **G-3 ✅ (2026-10-04, D-82)** — 공통원서 수집·이용 동의(문안은 계약 상수 `COMMON_PROFILE_COLLECTION_CONSENT`, 판 `2026-v1` — 운영기관·법무 초안). **공통원서 저장(PUT /api/v1/profile)은 본문 `collectionConsentVersion` 이 지금 판이어야 한다**(아니면 400). 중앙 마이그레이션 **0005**(`applicant_profile` 에 판·해시·시각 — 로컬 compose 중앙 DB 는 `npm run db:migrate:central`). 대학 제공 카드에 제공 고지. central-api 41개 통과(관리자 계정 DB 주소 `postgresql://wonseoro:wonseoro@localhost:5499/central` 로 돌린다)
- **G-10 일부 ✅ (2026-10-04, D-82)** — 지원자가 공통원서를 화면에서 바로 지운다(`DELETE /api/v1/profile`, OpenAPI 1.13.0, 확인 한 번 더). 값·데이터 키·대학별 제공 동의가 지워지고 값 없는 발급 증적은 남는다. 접근성 순회가 저장 → 삭제 확인 → 삭제를 돈다(지원자 22화면)
- **U-51 ✅ (2026-10-04)** — 감사자가 접수번호로 증적 패키지를 연다(`GET /admin/v1/evidence/by-number/{접수번호}`, Step-up 목록에 추가 — `oidc-routes.test`). 콘솔 증적 화면 입력칸은 접수번호·원서 ID 를 다 받는다
- **G-10 ✅ (2026-10-04, D-84)** — 대학 원서의 정보주체 권리 요청. 지원자는 원서 화면 맨 아래(취소된 원서 화면에도) "개인정보 열람·정정·삭제 요청" → `/privacy/{원서}` 에서 종류(열람·정정·삭제·처리정지)·내용을 보내고 결과를 본다. 요청번호 `PR-YYYYMMDD-XXXXXX`, 기한 = 받은 시각 + 10일(받을 때 넣는다). 같은 종류의 처리 중 요청을 다시 보내면 앞 요청이 200 으로 돌아온다. 입학처 콘솔 `/privacy`: 큐(처리 중은 기한 순, 줄에 내용 없음)·한 건 열기(내용 복호화, 감사 `ADMIN_VIEWED_PII`, Step-up)·회신(한 번, 일부 처리·거절은 사유 10자 이상, Step-up). 첫 화면 "지금 처리할 일" 에 처리 중·기한 지남 수. 요청 내용·회신은 **원서 데이터 키로 봉함**(`sealField`, 묶음 `privacy:<요청번호>:detail|result`). 범위는 `admin`. **실제 정정·삭제는 시스템이 하지 않는다**(보존 의무 — 입학처가 처리하고 회신). 감사 동작 `PRIVACY_REQUEST_RECEIVED`·`PRIVACY_REQUEST_DECIDED`. **새 운영 경로를 더하면 `oidc-routes.test` 의 Step-up 목록을 같이 고친다**(이번에 2개 추가). 시험 정리(`breakGlass`)가 고아 `privacy_request` 도 지운다 — **`privacy_request` 표가 없는 DB 에서는 breakGlass 를 쓰는 모든 시험이 실패한다**(0009 를 꼭 적용). 접근성 순회는 라디오 묶음을 Tab 자리 하나로 본다(같은 name 중 하나에 닿으면 된다 — 묶음 안은 화살표). 표 머리글에 숨김 글(`krds-sr-only`)을 쓰면 위치 고정이 표 스크롤 영역 밖으로 빠져 320px 가로 스크롤이 생긴다 — 보이는 글로
- **G-8 ✅ (2026-10-04, D-85)** — 민감정보 서류. 설정 `sensitiveDocuments: { 서류 종류: 별도 동의 코드 }`, 동의 문안은 `consents` 에 **필수 아님**. 형식 조회 서류에 `sensitiveConsentCode`. 업로드 의도는 그 동의(지금 판)가 없으면 400(`ConsentService.assertSensitiveConsent` — `DocumentService` 가 부른다, 생성자 6번째 인자). `missingRequired` 가 원서에 그 서류(삭제 상태 제외)가 있는데 동의가 없으면 `CONSENT_REQUIRED` 를 더한다 — 최종 검증·결제 전 확인 모두. 화면: 1단계 동의 칸에서 빼고 4단계 그 서류 위에 `ConsentPanel`(제목·안내·제목 id 를 넘긴다), 동의 전에는 올리는 칸이 없다. 오류 요약 링크는 4단계 체크로. 증적 열람 기록 details 에 `sensitiveDocuments` 수(패키지 모양·해시는 그대로). 설정 검사: 문안 없는 동의 → 거절, 필수 동의·안 받는 서류 → 경고, 이름에 장애·진단·입원 등이 보이는데 표시 없음 → 경고. 시드 학생부종합전형의 선택 서류 「장애인 증명서(해당자)」와 별도 동의는 최신 화면 캡처 08에 반영했다. 접근성 순회는 4단계에서 별도 동의를 Space 로 하고 한 번 더 돈다
- **G-12 ✅ (2026-10-04, D-86)** — 대학 고지 `notices.applicationRules`(법정 고지 목록 `UNIVERSITY_NOTICE_REQUIRED` 에 넣었다 — 없으면 설정 검사 경고). 접수 홈 「지원 전 확인」 전문 + 체크(`#rules-ack`) — 체크해야 "원서 작성 시작" 이 열린다. 원서 생성 요청 `rulesAcknowledged: true` → 새 원서에만 감사 `APPLICATION_RULES_ACKNOWLEDGED`(`ConsentService.acknowledgeRules`, 문안 SHA-256). **서버는 강제하지 않는다**(API 로 원서를 만드는 시험·부하 도구를 깨지 않게 — 대장 D-86 ④)
- **G-15 ✅·G-14 도구 (2026-10-05, D-91·D-92)** — 담당자 권한 부여·변경·말소 기록(0011 추가 전용·DB 해시 체인·WORM·수집 CronJob·감사자 콘솔 `/access-grants`), 유출 범위 산정·통지/신고 판정·절차서 초안([19](19-breach-response-runbook.md)). 맨 위 「세션 마감 상태(2026-10-05)」 참고
- **바로 다음 할 일** — A 목록과 개인정보·법정 고지의 AI 구현(G-15 포함), 최신 화면 캡처 43장까지 끝났다. 남은 것은 외부 환경·사람·기관 몫(03 B·C)과 사람이 적용할 노션 변경안(06)이다. 동의서 문안·법적 판단은 법무·대학 몫이다.

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
| **C 드라이브** | **거의 꽉 찼다(2026-10-02 남은 공간 약 2.5GB).** 저장소·Docker 저장소(`E:\DockerData\DockerDesktopWSL`)는 E 다. C 를 쓰던 것은 ① npm 내려받기 캐시(기본 `%LOCALAPPDATA%\npm-cache`, 약 9GB — 2026-10-02 지움) ② 시스템 임시 폴더. **이 프로젝트의 npm 캐시는 저장소 `.npmrc` 가 `.cache/npm`(E, git 제외)으로 고정한다.** 시험·캡처의 브라우저 프로필은 저장소 `.cache/`(git 제외, `tests/a11y/helpers/workdir.mjs`)에 두고 브라우저가 끝나면 지운다 — 전에는 C 임시 폴더에 실행마다 쌓였다(82개·3GB). 새 도구·임시 파일은 E 에 둔다(`E:\DockerData\tools\…`). 지우기·사용자 전역 설정 변경은 사용자 확인 뒤에 |
| 셸 | Git Bash 에서 `docker run -v/--tmpfs /tmp` 처럼 `/` 로 시작하는 인자는 경로 변환된다 → `export MSYS_NO_PATHCONV=1` |
| 도구 | kind 0.33 · Helm **4.3** · k6 2.2 · kubectl 1.34 (winget 설치). 새 터미널부터 PATH 에 잡힌다. 안 잡히면 `%LOCALAPPDATA%\Microsoft\WinGet\Packages\` 아래 `Helm.Helm_*\windows-amd64`, `Kubernetes.kind_*` 를 PATH 에 더한다. k6 는 `C:\Program Files\k6` |
| Docker | Desktop, VM 메모리 **약 7.5GB.** 이미지 빌드와 kind 클러스터 2개를 **동시에 돌리면 엔진이 멈춘다**(실제로 멈췄다). 빌드 → 클러스터 순서로, 하나씩 |
| 로컬 Flux 시험 | `E:\DockerData\gitops-test-20260929-1245` — bare `Wonseoro.git`·시험 사본 `work`(임시 SSH 서명키가 git 설정에 있음). kind-univ-a 의 Flux 리소스는 시험 뒤 suspend 상태. Git 서버는 `node tests/m4/helpers/git-smart-http-server.mjs <그 폴더> 9418` |
| CI 재현 | CI 통합 잡과 같은 순서를 빈 DB 로: `docker run -d --rm --name ci-pg -e POSTGRES_USER=wonseoro -e POSTGRES_PASSWORD=wonseoro -e POSTGRES_DB=univ_a -p 5499:5432 postgres:16-alpine` → `0001_init`·`0002_db_roles`·`dev-roles`·`verify-constraints`·`seed-dev`·`ci-seed-deadline` 적용 → `DATABASE_URL=…@localhost:5499/univ_a` 로 시험. kind 워크로드 간섭도 없다 |
| 로컬 관측 스택 | kind A `observability` 네임스페이스: Prometheus(KPI 규칙 포함)·Adapter·Grafana(익명 Viewer). Grafana 는 `kubectl -n observability port-forward svc/grafana 13000:80` |
| 중앙 DB 마이그레이션 | `infra/db/central/0001_init.sql`·`0002_vault.sql`·**`0003_summary_names.sql`**(2026-10-01) — `npm run db:migrate:central` 이 셋 다 적용한다 |
| 로컬 발급자 | compose 프로필 `auth` 의 `keycloak` :18080(약 75초에 뜬다, 메모리 약 600MB). 렐름·시험 계정 [infra/auth/README.md](../infra/auth/README.md). 틀린 비밀번호·OTP 를 5번 넣으면 그 계정이 잠시 잠긴다 — 시험을 다시 돌리기 전에 `up -d --force-recreate keycloak` 로 초기화 |
| 로컬 DB·저장소 | compose: `postgres-univ-a` :5432 · `postgres-univ-b` :5442(`--profile multi`) · `postgres-central` :5434 · redis :6379 · `object-storage`(RustFS) :9000, 콘솔 :9001. 예전 `.data/minio`는 보존하며 새 named volume을 쓴다 |
| 테스트 | DB 가 있어야 통합 테스트까지 돈다 — 명령은 [03-next-steps.md 끝](03-next-steps.md#개발-환경-되살리기). admission-api **395개 중 392 통과·3 skip·0 실패**(RustFS WORM 3개 실제 실행, 2026-10-04). `app.module.boot.test` 는 실제 AppModule 로 DI 를 조립한다 — 서비스를 직접 `new` 하는 통합 시험이 못 잡는 "서버가 안 뜨는" 결함용. 배포 스크립트 시험은 `npm run test:m4:gitops`(Peak 예약 9건 포함). **DB 통합 시험 전에 kind univ-a 의 API·Relay 를 0 으로 줄인다** — 같은 로컬 `univ_a` DB 를 봐서 시험 행을 먼저 집어 간다(결제 재확인·Relay 시험이 실패하거나 멈춘다). event-relay 시험은 직렬로 돈다 |
| 접근성 시험 | `npm run test:a11y:keyboard`(키보드 완주 — `--width=640`·`320`·`--text-zoom=2`·`--input=touch`·`--browser=edge`) · `test:a11y:focus -- applicant|admin`(전 화면 포커스·스크린리더 재료·가로 스크롤·대상 크기) · `test:a11y:deadline` · `test:a11y:session` · `test:a11y:rate-limit`. 화면 캡처와 같은 전용 DB·포트·서버(`shots-*`)를 쓴다 — 미리보기 서버 5개 한도 때문에 지원자 시험은 서류 워커, 콘솔 시험은 `shots-admin` 을 띄운다. 결과 `tests/a11y/results/`. **CI 는 `.github/workflows/a11y.yml`(2026-10-05, 매주·수동 — 서버 여섯·전용 DB·Object Storage 를 띄워 키보드 완주·지원자/콘솔 1280·320)** — 아직 원격에서 한 번도 돌리지 않았다(push 뒤 수동 실행으로 첫 확인) |
| 검사 | `npm run db:verify`(DB 제약 25종, 2026-10-05) · `node scripts/check-deps.mjs`(의존성 선언) · `helm lint deploy/charts/k-admission` · `node scripts/render-runtime-attachment.mjs --check`(runtime 첨부 = 차트 렌더링) · `npm run check:ui-copy`(화면 문구에 설계 번호·개발 안내·구조 설명 금지, T-M5-50) · `npm run check:contracts`(OpenAPI `$ref`·operationId·대장 번호·직전 커밋 대비 호환성, CloudEvents 컴파일·이벤트 타입) |
| 로컬 화면 확인 | kind 와 섞지 않으려면 로컬 프로세스를 CI 재현 DB 에 붙인다 — 중앙 :3100(`DATABASE_URL=…5499/central`)·대학 :3101(`…5499/univ_a`, `CENTRAL_SYNC_URL=http://localhost:3100`, `CORS_ORIGINS=http://localhost:4001`, `OTEL_METRICS_PORT` 를 9464 가 아닌 값으로)·지원자 웹 :4001(`NEXT_PUBLIC_ADMISSION_API`·`NEXT_PUBLIC_CENTRAL_API`). **:3000 은 쓰지 않는다** — kind 시험이 `ka-central` 을 거기 띄운다. 개발 시드 지원자: `44444444-4444-4444-4444-444444444444` / `subj-dev-0001` |
| 동시 작업 | 같은 폴더에서 다른 AI 세션이 커밋할 수 있다(2026-09-30 실제로 겹쳤다 — D-54 번호 충돌). 대장 번호를 쓰기 전에 대장 끝을 다시 읽고, 커밋 전에 `git log` 를 본다 |
| 노션 쓰기 | AI 의 노션 페이지 수정·첨부 교체는 **권한 분류기가 막는다**(2026-09-30, 외부 시스템 쓰기). 읽기(fetch)는 된다. 노션 변경은 [06-notion-changeset.md](06-notion-changeset.md) 로 준비하고 사람이 적용한다 |
| **호스트 포트 전달이 멈춘다** | kind 노드 컨테이너를 멈추거나 다시 켜면 Windows 호스트 → Docker Desktop 포트 전달(`localhost:18081`·`18082`)이 **수십 초~1분 넘게 응답하지 않는다** — 그동안 노드 안 NodePort·Pod·DB 는 정상이다(2026-09-30 구간별 측정). 노드 장애 시험의 부하를 호스트에서 보내면 이 멈춤을 장애로 센다. 그래서 `node-failure-kind.mjs` 는 부하를 kind Docker 네트워크 안 컨테이너(`tests/m4/helpers/load-users.mjs`, `docker run --network kind … node:22-alpine`)로 보낸다. 클러스터를 다시 켠 직후 `curl localhost:18081` 이 멈춰도 1분쯤 기다리면 풀린다 |
| **시험 스크립트는 부하 중 동기 호출 금지** | 부하가 도는 동안 `execFileSync(kubectl…)` 같은 동기 호출은 스크립트 자신의 이벤트 루프를 멈춰, 진행 중 요청의 timeout 을 한꺼번에 터뜨린다(서버에는 오류 없음). 부하 중에는 `execFile` 을 비동기로 쓰고 이벤트 루프 지연을 같이 잰다 |
| **셸 heredoc 의 역슬래시** | 이 PC 의 Bash 도구로 `python - <<'EOF'`·`cat <<'EOF'` 를 써서 파일을 고치면 **역슬래시가 한 단계 풀린다**(따옴표 친 heredoc 인데도) — 두 개는 하나가 되고, 파이썬 문자열의 역슬래시-n 은 진짜 줄바꿈이 된다. JSON 문자열의 줄바꿈 표기·SQL bytea 리터럴·정규식이 깨진다(2026-10-04 시드 JSON 과 시험의 bytea 값이 실제로 깨졌다). 역슬래시가 든 내용은 편집 도구(Write/Edit)로 쓰거나 파이썬에서 `chr(92)` 로 만든다 |
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

D-83 교체 뒤 같은 시험을 제품 중립 이름으로 다시 실행했다. RustFS 완전 단절 중 카탈로그 20회·원서 생성·자동저장이 계속되고 직접 업로드만 실패했으며, 복구 뒤 기존 단기 URL PUT과 완료 요청이 통과했다. 암호화된 원서 항목은 DB 평문 칼럼이 아니라 API 응답으로 확인한다. 결과는 `tests/m4/results/object-storage-outage-2026-10-04T06-20-30-645Z.json`.

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
| K-PaaS(또는 클라우드) 시험 환경 | 3,000 CCU·1,000 RPS·6시간 Soak·DB Failover 실측(T-M4-30~32·36·41)에 필요. 없음. 합성 사용자 k6 프로필·OIDC 갱신·k6+DB 사후 판정기는 [tests/load](../tests/load/README.md)에 준비됨 |
| 제출 PDF 정정 (D-2·D-3) | 개발보고서의 "Java/Spring" 표기 → NestJS·TypeScript. 정정 문구와 별도 제출용 A4 1쪽 PDF 준비됨 — [07-submission-errata.md](07-submission-errata.md). 제출·접수 확인은 사람 |
| 노션 반영 적용 | [06-notion-changeset.md](06-notion-changeset.md) — AI 쓰기 차단 |
| K-PaaS 착수 때 정할 것 | 노드 판정 시간(`node-monitor-grace-period`) 조정 가능 여부·zone 수·Gateway API 컨트롤러(ADR-0008, D-53) · clamd 배치(사이드카·공용 서비스)와 서명 DB 갱신 경로(D-58) · DB 서버 시각 동기 감시(D-61) |
| 실 clamd 로 검사 확인 (D-58) | ClamAV 어댑터는 가짜 clamd 로만 시험했다. `clamav/clamav` 이미지(약 300MB+서명 DB)를 내려받아 `SCANNER_ENGINE=clamav`·`CLAMD_HOST` 로 한 번 돌려 본다 — 내려받기는 사람이 승인한다 |
| Peak Mode 예약 워크플로 켜기 | GitHub environment `peak-mode` + secret `PEAK_MODE_SSH_SIGNING_KEY`, 저장소 변수 `PEAK_MODE_ENABLED=true`, 대학 `wonseoro-git-authors` 에 예약 자동화 공개키 추가 (ADR-0006) |
| ~~values-m 커넥션 수치 (D-44 ⑦)~~ | 2026-09-30 AI 결정: Pod 당 38·예산 400 유지 |
| 실물 Firefox·Safari 확인 (T-M5-47) | 이 PC 에 없다. 실물 Firefox(Windows)·iPhone Safari 15.4+ 로 접수 흐름을 한 번 따라가거나, 시험용 브라우저(Playwright Firefox·WebKit 약 300MB) 내려받기를 승인하면 AI 가 `tests/a11y/` 를 그 브라우저로 돌린다 — [09](09-accessibility.md#지원-브라우저-2026-10-01-ai-판단) |
| 실제 스크린리더 청취 (T-M5-48) | NVDA·센스리더·VoiceOver 로 듣는 검사. 전 화면 점검 결과의 Tab 자리별 대본(`say`)을 대조표로 쓴다 |
| 실 PG Sandbox·정산(T-M6-04·05) | 계약 PG 어댑터·Sandbox 계정·대학/PG 승인이 필요하다. 결제 9종·정산 5종 증적 양식과 `ops:pg-sandbox-acceptance` 게이트는 [18 §8.1](18-pilot-execution-package.md#81-t-m6-0405--실-pg-sandbox-수용-게이트)에 준비됨 |
| Pilot 런북·캘린더·훈련·영향평가·Compliance·Shadow (T-M6-08~15 중 사람 몫) | 실행 절차·증적 양식·자동 누락 게이트는 [18](18-pilot-execution-package.md)과 `deploy/pilot/`에 준비했다. 대학별 사본을 채워 `npm run ops:pilot-readiness -- --file=...`가 성공해야 완료 판정 |

## 6. 전체 남은 규모

146개 중 **125개 완료, 21개 남음**(2026-10-04). **A. AI 가 이 PC 에서 끝낼 수 있는 것 0개 · B. 외부 환경(K-PaaS·HA DB·PG 계약) 12개 · C. 사람·기관 9개**(T-M5-47 나머지 실물 브라우저 포함).
목록과 권장 순서는 [03-next-steps.md 「완성까지 남은 단계」](03-next-steps.md#완성까지-남은-단계-2026-10-01-전수-점검).

## 7. 어디에 무엇이 있나

| 찾는 것 | 위치 |
|---|---|
| 지금 할 일 | [03-next-steps.md](03-next-steps.md) |
| 단계별 태스크·인수기준 | [milestones/](milestones/) |
| 설계와 구현이 다른 곳 66건 | [02-spec-discrepancy-register.md](02-spec-discrepancy-register.md) |
| 화면 캡처·다시 찍는 법 | [screenshots/README.md](screenshots/README.md) |
| 화면 제품화 — 화면 결함·개발 흔적 전수 목록(U-1~U-59)·결정·문구 검사 | [08-ui-production-readiness.md](08-ui-production-readiness.md) |
| 접근성 — 시험·찾은 결함·세션 만료·CAPTCHA 결정·지원 브라우저 | [09-accessibility.md](09-accessibility.md) · 시험 `tests/a11y/` · KRDS `LiveRegion`·`TableScroll`·`Alert focusKey`·`Card titleId/titleLevel` |
| 인증 착수 준비 — 현황·결정 A1~A12(로컬 Keycloak·API 직접 검증·JWKS 캐시·역할 매핑·MFA·step-up)·작업 순서·인수 시험 | [12-authentication-plan.md](12-authentication-plan.md) |
| 개인정보·법정 고지 — 원서에 받을 항목·필수 절차·고지 체크리스트·지금과의 차이(G-1~G-15)·법무 쟁점 | [10-admission-privacy-and-legal-notices.md](10-admission-privacy-and-legal-notices.md) (2026-10-02 현행 법령 원문 기준, 법률자문 아님) |
| 흉내·미연결 점검 결과와 일부러 남긴 흉내 | [04-production-readiness.md §7](04-production-readiness.md#7-흉내미연결-전수-점검-2026-09-30) |
| 노션 문서 지도·동기화 규칙 | [01-notion-sync-protocol.md](01-notion-sync-protocol.md) |
| 왜 이렇게 정했나 | [adr/](adr/) — 최신 ADR-0009 퍼즐형 CAPTCHA 를 두지 않는다(한도에 걸린 사람의 접근 가능한 길) · ADR-0008 노드 장애 흡수 |
| 배포 | `deploy/` — 차트 `charts/k-admission`, 대학별 `universities/`, 로컬 `local/` |
| API 계약 | `packages/contracts/openapi/k-admission.v1.yaml` (v1.8.0) — 컨트롤러와 다르면 계약 적합성 시험이, 계약 파일이 깨지거나 비호환이면 `check:contracts` 가 깨진다 |
| 사람 말 사전(상태·행위·예외 등 화면 이름) | `packages/contracts/src/labels.ts` — 화면은 내부 코드를 그대로 보이지 않는다 (T-M5-51) |
| 날짜·시각 표기·아이콘 | `packages/krds/src/format.ts`(언제나 한국 시간)·`icon.tsx`(SVG) — 화면은 `toLocaleString`·이모지를 직접 쓰지 않는다 (T-M5-54) |
| 오류 문구표(오류 code → 화면 제목·설명) | `packages/contracts/src/problem-text.ts` — 화면은 서버 오류 문구를 그대로 보이지 않는다. 조사 함수 `josa.ts` (T-M5-52) |
| 공통원서 표준 항목 | `packages/contracts/src/common-profile.ts` — 중앙 Vault 검증·지원자 화면·설정 검사가 같이 쓴다 (D-57) |
| DB 스키마 | `infra/db/migrations/0001_init.sql`(= 노션 §02 첨부 v1.2) · `0002_db_roles.sql` |
