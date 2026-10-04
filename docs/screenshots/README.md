# 화면 캡처

> 찍은 날: **2026-10-04**(개인정보·법정 고지 G-1~G-13의 AI 구현과 인증 T-M5-02·10 이후) · 로컬 **축소 환경**(한 PC, 로컬 프로세스) · 1280px 데스크톱 · 전체 페이지
> 개발 모드 — 지원자 웹·장애 화면 22장 · 관리자 콘솔 12장. **로그인 모드**(본인확인·관리자 로그인) — 8장(28~35). 모두 42장.
> 새로 찍은 개발 모드 34장과 로그인 모드 28~34번은 **렌더링 문구 검사**(`capture.mjs --check-copy`)에서 위반이 없었다. 35번은 화면 코드가 바뀌지 않은 2026-10-03 통과본이다. 검사 내용은 화면에 실제로 보이는 글에 설계 문서 번호·내부 상태 코드·ISO 시각 원문·영문 검증 문구·기호 아이콘이 없는지다. 지원자 화면은 UUID·내부 버전도 막는다.
> 다시 찍는 방법은 아래 [「다시 찍기」](#다시-찍기)에 있다. 스크립트는 `scripts/screenshots/`에 있다.
> 처음 찍은 판(2026-09-30)과 그때 찾은 결함 U-1~U-11 은 git 이력에 있다. 결함은 [08-ui-production-readiness.md](../08-ui-production-readiness.md) 의 U-1~U-59 로 옮겨 모두 고쳤다(U-51 도 2026-10-04 끝).
> **2026-10-04 전체 갱신** — 접수 홈 지원 제한 확인(D-86), 3단계 여권번호 별도 동의(D-88), 4단계 장애인 증명서 별도 동의(D-85), 원서의 개인정보 권리·전형료 반환 카드와 신청 화면(D-84·D-89), 콘솔 처리 큐를 실제 요청번호로 이어 찍었다. 중앙·대학 장애 화면과 콘솔 20~27, 로그인 28~34도 다시 찍었다. 캡처 자동화에서 대조 예외용 원서의 필수 동의 누락과 증적 입력의 옛 라벨을 함께 고쳤다.

## 어떤 조건에서 찍었나

| 항목 | 이 캡처에서 | 운영에서 |
|---|---|---|
| 본인 확인 | 개발 서버에서만 보이는 "본인확인 (개발용)" 칸에 지원자 식별자·가명 토큰을 넣는다 | 본인확인·OIDC(T-M5-02). 이 입력칸은 운영 빌드에 없다 — 켜서 빌드하면 멈춘다(T-M5-53) |
| 관리자 신원 | 콘솔의 "담당자 ID" 입력칸(`officer1~3@univ-a`) — 개발 서버에서만 | 관리자 SSO·MFA(T-M5-10). 운영 빌드에는 입력칸이 없고, 운영 모드에서 콘솔이 거절한다 |
| 결제 | Mock PG — 결제 즉시 확인된다 | 실 PG(T-M6-04) |
| 서류 검사 | Mock 검사 엔진(`SCANNER_ENGINE=mock`) — 약 4초 뒤 "검사 완료" | ClamAV(D-58) |
| 데이터 | 전용 DB 컨테이너 `ui-shots-pg`(:5497)에 개발 시드(`seed-dev.sql`)를 넣었다. 원서로대학교 · 2027 수시 · 학생부종합전형 · 컴퓨터공학과 · 전형료 55,000원 | — |
| 마감 정책 | 콘솔 API로 **작성 officer1 → 승인 officer2·officer3 → 적용**. 서명된 적용 기록이 남는다(마감 2026.12.31 18:00) | 같은 절차 |
| 격리 | 중앙 :3100 · 대학 :3101 · 서류 워커 :3102 · 중계기 :3103 · 지원자 웹 :4001 · 콘솔 :4101 | kind 시험·로컬 개발 DB(:5432)·`ka-central`(:3000)은 건드리지 않았다 |

**연출한 장면이 셋 있다.** 모두 실제 코드 경로가 만든 화면이다. 다만 기다림을 줄이려고 준비 단계를 거쳤다.

- **15~17** 중앙 장애: 캡처용 중앙 API 프로세스를 내렸다.
- **18~19** 대학 장애: 캡처용 대학 API 프로세스를 내렸다. 18번은 새 브라우저로 처음 연 화면이라 "이 기기에 남은 저장 기록" 이 없다 — 그래서 마지막 저장이 "확인할 수 없습니다" 다(모르면 모른다고 쓴다).
- **25** 대조 예외:
  - 중계기를 멈춘 채 두 번째 지원자가 접수했다. 그래서 통합 조회 반영 알림이 전송되지 않고 남는다.
  - 대조는 30분 넘게 중앙 확인이 없어야 이 원서를 잡는다. 30분을 기다리지 않으려고 이 알림의 생성 시각을 DB에서 31분 앞당겼다(`prepare.sh recon`).
- **24** 설정 초안: 콘솔 API로 만들었다. 내신 성적 항목을 지우고 지원 동기 항목을 더한 초안이다.

## 지원자 웹

| 파일 | 화면 | 보이는 것 |
|---|---|---|
| [01-home](applicant/01-home.png) | 접수 홈 | 머리글에 대학·모집 이름. 모집·전형·모집단위·전형료는 **대학 카탈로그 API**에서 읽는다. 개발 서버의 본인확인 칸 |
| [02-profile-empty](applicant/02-profile-empty.png) | 공통원서 — 처음 | Label과 Placeholder가 따로 있다. 대학별 제공 동의 |
| [03-profile-saved](applicant/03-profile-saved.png) | 공통원서 — 저장 | 저장 시각. 동의한 항목만 원서에 복사된다 |
| [04-apply-step1-common](applicant/04-apply-step1-common.png) | 원서 1단계 공통정보 | 경로 "홈 › 2027 수시 › 원서로대학교 › 공통정보". 마감 배너 "마감 2026.12.31 18:00 (서버 시각 기준)" · 6단계 표시 |
| [05-apply-step2-program](applicant/05-apply-step2-program.png) | 2단계 대학·전형 | 대학·전형·모집단위·전형료 |
| [06-apply-validation-errors](applicant/06-apply-validation-errors.png) | 검토 전 검증 오류 | "출신 고등학교를 입력해 주십시오." — 항목 이름으로 쓴 한국어 문장, 누르면 그 칸으로 간다(공통원서를 쓰지 않은 두 번째 지원자) |
| [07-apply-step3-extra](applicant/07-apply-step3-extra.png) | 3단계 추가정보 | 내신 성적·학적 변동 사항과 **여권번호 별도 동의**. 동의한 뒤에만 여권번호 칸이 나타난다 |
| [08-apply-step4-documents](applicant/08-apply-step4-documents.png) | 4단계 서류 | 형식·크기 안내 · 학교생활기록부 검사 완료 · **장애인 증명서 민감정보 별도 동의**와 동의 뒤 업로드 칸 |
| [09-apply-step5-review](applicant/09-apply-step5-review.png) | 5단계 검토·결제 | 검증을 통과한 단계에만 ✓ · 누락·서류·전형료·결제 상태·서버 시각·마감 · "결제가 곧 접수" 경고 · **결제 전 확인 체크**(체크해야 결제 버튼이 열린다) |
| [10-apply-complete](applicant/10-apply-complete.png) | 접수 완료 | 접수번호 · 접수 시각 |
| [11-receipt](applicant/11-receipt.png) | 접수증 | 대학·모집 · 접수번호 · 접수 시각 · **전형 · 모집단위 · 상태** · "원서로대학교 입학처가 발급한 접수증". 인쇄하면 메뉴·버튼은 빠진다 |
| [12-dashboard](applicant/12-dashboard.png) | 내 원서 | "학생부종합전형 · 컴퓨터공학과" · 접수 완료 · 조회 시각 · 카드별 동기화 시각 |
| [13-apply-cancel-confirm](applicant/13-apply-cancel-confirm.png) | 원서 취소 | 사유 입력 · 되돌릴 수 없음 안내 |
| [14-apply-cancelled](applicant/14-apply-cancelled.png) | 취소된 원서 | 새 원서로 다시 지원하라는 안내 |
| [36-apply-rights-refund](applicant/36-apply-rights-refund.png) | 접수한 원서 | 맨 아래 **내 개인정보**·**전형료 반환** 카드와 각 신청 화면으로 가는 길 |
| [37-privacy-request](applicant/37-privacy-request.png) | 개인정보 권리 요청 | 실제 열람 요청번호·받은 시각·10일 처리 기한·보낸 내용 |
| [38-fee-refund-request](applicant/38-fee-refund-request.png) | 전형료 반환 신청 | 실제 신청번호·낸 전형료·끝 네 자리만 보이는 계좌·검토 상태 |

### 장애 중 화면

| 파일 | 상황 | 보이는 것 |
|---|---|---|
| [15-home-central-down](failure/15-home-central-down.png) | 중앙 정지 | 접수 홈에 운영 배너가 뜬다. 대학 서버가 계속 처리하니 다시 결제·작성하지 말라는 안내 |
| [16-dashboard-central-down](failure/16-dashboard-central-down.png) | 중앙 정지 | 내 원서 — **"이미 접수한 원서는 영향을 받지 않습니다"**. 조회 실패를 접수 실패처럼 보이게 하지 않는다 |
| [17-profile-central-down](failure/17-profile-central-down.png) | 중앙 정지 | 공통원서를 쓸 수 없다. 원서는 직접 입력으로 계속 쓸 수 있다 |
| [18-apply-university-down](failure/18-apply-university-down.png) | 대학 API 정지 | 화면 큰 제목 "원서 작성"(2026-10-01 다시 찍음 — T-M5-42, 화면마다 h1 하나) · 작성한 내용이 보관되어 있다는 안내(포커스를 받는다) · **마지막 저장 · 서버가 확인한 상태 · 요청번호**를 언제나 채운다(모르면 모른다고) · 현재 상태 다시 확인 |
| [19-home-university-down](failure/19-home-university-down.png) | 대학 API 정지 | 모집 정보를 불러올 수 없다는 안내 · 다시 시도 |

## 관리자 콘솔

| 파일 | 화면 | 보이는 것 |
|---|---|---|
| [20-console-home](admin/20-console-home.png) | 콘솔 첫 화면 | **지금 처리할 일** — 승인 대기 설정·마감 정책, 미해결 불일치, 지금 마감 · 짧은 메뉴 |
| [21-deadline-extension-draft](admin/21-deadline-extension-draft.png) | 마감 연장 초안 | 결정 문서번호·사유·**새 마감시각(한국 시간)**. 작성자(officer1)는 승인할 수 없다 — 버튼 옆에 이유 · 서명된 적용 이력(서명 키는 접어 둠) |
| [22-deadline-one-approval](admin/22-deadline-one-approval.png) | 마감 연장 승인 1 | officer2가 승인했다. 적용하려면 승인 한 명이 더 필요하다 · 판정 방식 "마감 전에 접수가 확정된 원서만 인정" |
| [23-config-versions](admin/23-config-versions.png) | 설정 버전 | 적용 중인 설정 v1 · 승인 대기 초안 v2 |
| [24-config-review](admin/24-config-review.png) | 설정 초안 검토 | "학생부종합전형 — '내신 성적' 항목이 삭제됩니다" — **되돌리기 어려운 변경 경고**(설정 위치는 접어 둠) · 확인 체크 전에는 승인 버튼이 꺼져 있다 · 2인 승인 |
| [25-reconciliation](admin/25-reconciliation.png) | 대조·예외 | "통합 조회 반영 지연 — 접수 실패 아님" · 사실 항목을 사람 말로(전송 상태·생성 시각·전송 시도) · 처리 코드·사유를 적어야 해소 |
| [26-evidence](admin/26-evidence.png) | 증적 조회 | 조회 사유가 기록된다 · **감사 체인 끊김 없음**(D-62 수정) · 판정에 쓰인 마감 정책과 서명 · 처리 이력 · 결제·서류 |
| [27-retention](admin/27-retention.png) | 보존기간 | 데이터 종류별 하한과 근거(법령·규정 이름) · 파기 계획만 보여 준다(실행하지 않음) |
| [39-privacy-queue](admin/39-privacy-queue.png) | 권리 요청 처리 큐 | 요청 종류·접수번호·받은 시각·처리 기한·상태. 줄에는 요청 내용이 없다 |
| [40-privacy-detail](admin/40-privacy-detail.png) | 권리 요청 열람·회신 | 열람 감사 안내·요청 내용·처리 결과와 지원자 안내 입력 |
| [41-fee-refund-queue](admin/41-fee-refund-queue.png) | 전형료 반환 큐 | 신청 사유·접수번호·낸 전형료·검토 상태. 줄에는 계좌 원문이 없다 |
| [42-fee-refund-detail](admin/42-fee-refund-detail.png) | 전형료 반환 열람·결정 | 열람 감사 안내·계좌와 신청 내용·결정과 지원자 안내 입력 |

27번의 "보존 정책이 설정되지 않았습니다"는 결함이 아니다. 개발 시드 설정에 보존기간이 없어서 뜬 경고다. 대학이 설정 승인으로 넣어야 하는 값이다(D-38).

## 로그인 모드 (2026-10-04, T-M5-02·10)

지원자 화면은 `NEXT_PUBLIC_AUTH_MODE=oidc`, 콘솔은 `ADMIN_AUTH_MODE=oidc` 로 띄웠다(미리보기 `auth-web`·`auth-admin`·`auth-admission`·`auth-central`).
로그인 서버는 로컬 Keycloak 26.8.0 에 원서로 로그인 테마(`infra/auth/themes/wonseoro` — 접근성 보완)를 입혔다. 로그인 서버 화면은 Keycloak 기본 틀이고, 이 PC 의 헤드리스 Chrome 이 어두운 화면 설정이라 어두운 판으로 찍혔다.
개발용 본인확인 칸·담당자 ID 칸은 이 모드에 없다. 상단의 "통합 조회 반영이 지연되고 있습니다" 는 중계기를 띄우지 않아 나온 운영 배너다.

| 파일 | 화면 | 보이는 것 |
|---|---|---|
| [28-login-required](applicant/28-login-required.png) | 본인확인 전 접수 홈 | 원서를 쓰려면 본인확인이 필요하다는 안내와 "본인확인" 버튼. 모집·전형은 로그인 전에도 보인다 |
| [29-issuer-applicant](login/29-issuer-applicant.png) | 로그인 서버 — 지원자 | "원서로 지원자" · 한국어 · 화면 언어 선택 |
| [30-signed-in](applicant/30-signed-in.png) | 본인확인 뒤 접수 홈 | "본인확인을 마쳤습니다" · 로그아웃 |
| [31-ratelimit-reauth](applicant/31-ratelimit-reauth.png) | 위험 차단 | 기다릴 시각·요청번호와 함께 **본인확인 다시 하기**(ADR-0009). 차단 응답은 서버의 실제 모양을 요청 하나에만 돌려줬다 — 서버 쪽 해제는 통합 시험이 본다 |
| [32-console-login-required](admin/32-console-login-required.png) | 콘솔 로그인 전 | 관리자 로그인 안내 — 비밀번호와 인증 앱의 일회용 번호 |
| [33-issuer-staff-otp](login/33-issuer-staff-otp.png) | 로그인 서버 — 담당자 일회용 번호 | 비밀번호 다음 화면. 사용자 이름 칸에 이름이 붙어 있다(기본 테마 결함을 테마가 고친다) |
| [34-console-signed-in](admin/34-console-signed-in.png) | 로그인 뒤 콘솔 | 담당자 이름·역할(보안 감사)·로그아웃 · 증적 조회 |
| [35-console-reauth](admin/35-console-reauth.png) | 민감 동작 재인증 | 로그인 5분 뒤 증적 열람 — "본인 확인을 한 번 더 해 주십시오" 와 본인 확인 다시 하기. 처리된 것은 없다 |

## 다시 찍기

Docker·Node 22+·Chrome이 필요하다. Chrome 경로가 다르면 `CHROME` 환경변수로 준다. 따로 설치할 것은 없다. 스크립트가 Chrome을 헤드리스로 띄워 DevTools 프로토콜로 조작한다.
**kind 시험 중에도 돌릴 수 있다.** 전용 DB·전용 포트만 쓴다. 다만 Docker 메모리를 조금(PostgreSQL 컨테이너 하나) 더 쓴다. 서류 업로드에 로컬 Object Storage(:9000)가 필요하다 — 꺼져 있으면 `docker compose -f infra/compose/docker-compose.dev.yml up -d object-storage`.

서버는 `.claude/launch.json`의 `shots-*` 구성을 쓴다. env는 `scripts/screenshots/env/`에 있다. API·워커는 빌드 산출물(`dist`)로 뜬다. 코드가 바뀌었으면 먼저 `npm run build`를 한다. 지원자 웹·콘솔은 `next dev` 로 뜬다 — 개발용 신원 입력이 켜진다(T-M5-53).
Claude 데스크톱의 미리보기는 서버를 5개까지만 띄울 수 있다. 그래서 단계마다 워커를 내리고 올린다.
`--check-copy` 를 붙이면 찍는 화면마다 렌더링 문구 검사를 하고, 위반이 있으면 실패로 끝난다.

```
1. bash scripts/screenshots/prepare.sh db              # 서버가 떠 있어도 된다(D-63 이후 DB 를 다시 만들어도 죽지 않는다)
2. 띄우기: shots-central · shots-admission · shots-scanner · shots-relay · shots-web
3. bash scripts/screenshots/prepare.sh policy
4. node scripts/screenshots/capture.mjs applicant docs/screenshots --check-copy       # 01~14·36~38
5. shots-central 내림 → capture.mjs central-down … (15~17) → shots-central 띄움
6. shots-admission 내림 → capture.mjs admission-down … (18~19) → shots-admission 띄움
7. shots-relay 내림 → capture.mjs seed-recon → prepare.sh recon → prepare.sh config
8. shots-scanner 내림 → shots-admin 띄움 → capture.mjs admin … (20~27·39~42)
   # 후반만 다시 찍을 때: capture.mjs admin-tail … (26·27·39~42)
9. 모두 내리고 docker rm -f ui-shots-pg
10. 로그인 모드(28~35): 로컬 발급자(--profile auth)·CI 재현 DB(:5499) → auth-admission · auth-central · auth-web · auth-admin 띄우기
    → node scripts/screenshots/capture.mjs auth docs/screenshots --check-copy   # 재인증 창 5분을 실제로 기다린다(약 7분)
```

단계 사이에 이어 쓰는 원서 ID와 실패 화면(`fail-<단계>.png`)은 저장소 `.cache/shots/`(git 제외)에 남는다.
업로드한 샘플 PDF는 로컬 Object Storage의 `ui-shots-documents` 버킷에 쌓인다.
출력 폴더를 바꾸면(두 번째 인자) 저장소 캡처를 건드리지 않고 확인만 할 수 있다.
