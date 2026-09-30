# 화면 캡처

> 찍은 날: 2026-09-30 · 로컬 **축소 환경**(한 PC, 로컬 프로세스) · 1280px 데스크톱 · 전체 페이지
> 지원자 웹(`apps/frontend`) 19장 · 관리자 콘솔(`apps/admin-web`) 8장, 모두 27장.
> 코드 기준은 커밋 `4199600`의 빌드(dist)다.
> 같은 시각 다른 세션이 진행 중이던 `server-kit`의 DB 연결 설정 변경이 빌드에 들어가 있다. 이 변경은 화면과 무관하다.
> 다시 찍는 방법은 아래 [「다시 찍기」](#다시-찍기)에 있다. 스크립트는 `scripts/screenshots/`에 있다.

## 어떤 조건에서 찍었나

| 항목 | 이 캡처에서 | 운영에서 |
|---|---|---|
| 본인 확인 | 개발용 입력칸에 지원자 식별자·가명 토큰을 직접 넣는다 | 본인확인·OIDC(T-M5-02). 운영 모드에서는 이 입력칸으로 기동하지 않는다 |
| 관리자 신원 | 콘솔의 "담당자 ID" 입력칸(`officer1~3@univ-a`) | 관리자 SSO·MFA(T-M5-10). 운영 모드에서 콘솔이 거절한다 |
| 결제 | Mock PG — 결제 즉시 확인된다 | 실 PG(T-M6-04) |
| 서류 검사 | Mock 검사 엔진(`SCANNER_ENGINE=mock`) — 약 4초 뒤 "검사 완료" | ClamAV(D-58) |
| 데이터 | 전용 DB 컨테이너 `ui-shots-pg`(:5497)에 개발 시드(`seed-dev.sql`)를 넣었다. 원서로대학교 · 2027 수시 · 학생부종합전형 · 컴퓨터공학과 · 전형료 55,000원 | — |
| 마감 정책 | 콘솔 API로 **작성 officer1 → 승인 officer2·officer3 → 적용**. 서명된 적용 기록이 남는다(마감 2026-12-31 18:00) | 같은 절차 |
| 격리 | 중앙 :3100 · 대학 :3101 · 서류 워커 :3102 · 중계기 :3103 · 지원자 웹 :4001 · 콘솔 :4101 | kind 시험·로컬 개발 DB(:5432)·`ka-central`(:3000)은 건드리지 않았다 |

**연출한 장면이 셋 있다.** 모두 실제 코드 경로가 만든 화면이다. 다만 기다림을 줄이려고 준비 단계를 거쳤다.

- **15~17** 중앙 장애: 캡처용 중앙 API 프로세스를 내렸다.
- **18~19** 대학 장애: 캡처용 대학 API 프로세스를 내렸다.
- **25** 대조 예외:
  - 중계기를 멈춘 채 두 번째 지원자가 접수했다. 그래서 중앙 반영 이벤트가 전송되지 않고 남는다.
  - 대조는 30분 넘게 중앙 확인이 없어야 이 원서를 잡는다. 30분을 기다리지 않으려고 이 이벤트의 생성 시각을 DB에서 31분 앞당겼다(`prepare.sh recon`).
- **24** 설정 초안: 콘솔 API로 만들었다. 내신 성적 항목을 지우고 지원 동기 항목을 더한 초안이다.

## 지원자 웹

| 파일 | 화면 | 보이는 것 |
|---|---|---|
| [01-home](applicant/01-home.png) | 접수 홈 | 모집·전형·모집단위·전형료를 **대학 카탈로그 API**에서 읽는다. 개발용 본인 확인 입력 |
| [02-profile-empty](applicant/02-profile-empty.png) | 공통원서 — 처음 | Label과 Placeholder가 따로 있다. 대학별 제공 동의 |
| [03-profile-saved](applicant/03-profile-saved.png) | 공통원서 — 저장 | 저장 시각. 동의한 항목만 원서에 복사된다 |
| [04-apply-step1-common](applicant/04-apply-step1-common.png) | 원서 1단계 공통정보 | 동의한 공통원서 항목이 채워져 있다. 서버 시각 기준 마감 카운트다운 · 6단계 표시 |
| [05-apply-step2-program](applicant/05-apply-step2-program.png) | 2단계 대학·전형 | 대학·전형·모집단위·전형료. 전형을 바꾸면 달라진다는 안내 |
| [06-apply-validation-errors](applicant/06-apply-validation-errors.png) | 검토 전 검증 오류 | 빠진 항목을 화면 위에 한꺼번에 모아 보여 준다(공통원서를 쓰지 않은 두 번째 지원자) |
| [07-apply-step3-extra](applicant/07-apply-step3-extra.png) | 3단계 추가정보 | 전형 양식(JSON Schema)으로 그린 입력칸 · 양식 버전 · 글자 수 · 자동저장 완료 시각 |
| [08-apply-step4-documents](applicant/08-apply-step4-documents.png) | 4단계 서류 | 파일 선택 버튼(끌어다 놓기만 주지 않음) · 업로드 · 악성코드 검사 상태를 글로 표시 |
| [09-apply-step5-review](applicant/09-apply-step5-review.png) | 5단계 검토·결제 | 누락·서류·전형료·결제 상태·서버 시각·마감을 한 화면에. "결제가 곧 접수" 경고 |
| [10-apply-complete](applicant/10-apply-complete.png) | 접수 완료 | 접수번호 · 접수 시각 · 적용 마감정책 버전 |
| [11-receipt](applicant/11-receipt.png) | 접수증 | 인쇄용 |
| [12-dashboard](applicant/12-dashboard.png) | 내 원서 | 중앙 요약 · 중앙 조회 기준 시각 · 카드별 동기화 시각 |
| [13-apply-cancel-confirm](applicant/13-apply-cancel-confirm.png) | 원서 취소 | 사유 입력 · 되돌릴 수 없음 안내 |
| [14-apply-cancelled](applicant/14-apply-cancelled.png) | 취소된 원서 | 새 원서로 다시 지원하라는 안내 |

### 장애 중 화면

| 파일 | 상황 | 보이는 것 |
|---|---|---|
| [15-home-central-down](failure/15-home-central-down.png) | 중앙 정지 | 접수 홈에 운영 배너가 뜬다. 대학 서버가 계속 처리하니 다시 결제·작성하지 말라는 안내 |
| [16-dashboard-central-down](failure/16-dashboard-central-down.png) | 중앙 정지 | 내 원서 — **"이미 접수한 원서는 영향을 받지 않습니다"**. 조회 실패를 접수 실패처럼 보이게 하지 않는다 |
| [17-profile-central-down](failure/17-profile-central-down.png) | 중앙 정지 | 공통원서를 쓸 수 없다. 원서는 직접 입력으로 계속 쓸 수 있다 |
| [18-apply-university-down](failure/18-apply-university-down.png) | 대학 API 정지 | 작성한 내용이 보관되어 있다는 안내 · 현재 상태 다시 확인 버튼 |
| [19-home-university-down](failure/19-home-university-down.png) | 대학 API 정지 | 모집 정보를 불러올 수 없다는 안내 · 다시 시도 |

## 관리자 콘솔

| 파일 | 화면 | 보이는 것 |
|---|---|---|
| [20-console-home](admin/20-console-home.png) | 콘솔 첫 화면 | 콘솔이 하는 일과 **하지 않는 일**. 담당자를 지정하지 않으면 조회만 된다 |
| [21-deadline-extension-draft](admin/21-deadline-extension-draft.png) | 마감 연장 초안 | 결정 문서번호·사유·새 마감. 작성자(officer1)는 승인할 수 없다 — 버튼 옆에 이유 · 서명된 적용 이력 |
| [22-deadline-one-approval](admin/22-deadline-one-approval.png) | 마감 연장 승인 1 | officer2가 승인했다. 적용하려면 승인 한 명이 더 필요하다 |
| [23-config-versions](admin/23-config-versions.png) | 설정 버전 | 적용 중인 설정 v1 · 승인 대기 초안 v2 |
| [24-config-review](admin/24-config-review.png) | 설정 초안 검토 | 현재 설정 대비 변경 — **되돌리기 어려운 변경(항목 삭제) 경고** · 확인 체크 전에는 승인 버튼이 꺼져 있다 · 2인 승인 |
| [25-reconciliation](admin/25-reconciliation.png) | 대조·예외 | "중앙 통합 조회 반영 지연 — 접수 실패 아님" 예외 · 처리 코드·사유를 적어야 해소 |
| [26-evidence](admin/26-evidence.png) | 증적 조회 | 조회 사유가 기록된다 · 감사 체인 검증 · 판정에 쓰인 마감 정책과 서명 · 타임라인 · 결제·서류 |
| [27-retention](admin/27-retention.png) | 보존기간 | 데이터 종류별 하한과 근거 · 파기 계획만 보여 준다(실행하지 않음) |

## 캡처하며 발견한 화면 결함

화면을 하나씩 보며 찾은 것이다. **고치지 않았다.** 다음 화면 작업(M5 접근성 T-M5-40~48 전후)에서 다룬다.

| # | 화면 | 무엇이 문제인가 |
|---|---|---|
| U-1 | 06 | 검증 오류 요약이 검증기의 **영문 원문과 필드 코드** 그대로다. 예: `highSchool — must have required property 'highSchool'`. 지원자가 읽을 한국어 문구도, 양식의 `title`(출신 고등학교)도 아니다 |
| U-2 | 06 → 08 | 오류 요약이 입력을 고친 뒤에도 **다음 검증 전까지 남는다.** 다른 단계로 가도 그대로 보인다. 첫 캡처에서 3단계를 채운 뒤 4단계에 옛 오류가 남아 있었다 |
| U-3 | 06 | 단계 표시기가 입력이 빠진 앞 단계에도 ✓를 붙인다. 지나간 단계라는 뜻일 뿐, 완료했다는 뜻이 아니다 |
| U-4 | 04~10 | 마감 배너가 "마감 18시 0분 0초"처럼 **날짜 없이 시각만** 보인다(`formatKstTime`). 91일 남은 마감인데 날짜를 알 수 없다 |
| U-5 | 08 | 업로드 칸의 문구가 검사가 끝난 뒤에도 "업로드 완료 — 악성코드 검사 중입니다"로 남는다. 바로 아래 목록은 "검사 완료"다 |
| U-6 | 11 | 접수증에 **전형·모집단위·상태가 없다.** T-M2-11 인수기준은 "제출시각·전형·모집단위·상태"다 |
| U-7 | 12 | 내 원서 카드가 전형·모집단위를 **코드**(`EARLY · CSE`)로 보인다 |
| U-8 | 18 | 대학 서버에 처음부터 닿지 못하면 재조회 버튼만 남는다. 원서를 한 번도 읽지 못해서 마지막 저장 시각·서버가 확인한 상태·요청번호가 모두 비어 있다. 장애 UX(T-M2-31)가 약속한 넷 중 셋이 이 경우 빠진다 |
| U-9 | 콘솔 마감 | 데이터를 불러오는 동안 **"적용 중인 마감 정책이 없습니다" 경고가 먼저 뜬다.** 불러오는 중과 정말 없는 상태를 구분하지 않는다 |
| U-10 | 25 | 대조 예외의 사실 항목이 내부 이름(`status`·`created_at`·`attempt_count`)과 UTC ISO 원문으로 보인다 |
| U-11 | 27 | 보존기간 표의 좁은 열 머리글이 한 글자씩 줄바꿈된다("설/정", "대/상") |

27번의 "보존 정책이 설정되지 않았습니다"는 결함이 아니다. 개발 시드 설정에 `retention`이 없어서 뜬 경고다. 대학이 설정 승인으로 넣어야 하는 값이다(D-38).

## 다시 찍기

Docker·Node 22+·Chrome이 필요하다. Chrome 경로가 다르면 `CHROME` 환경변수로 준다. 따로 설치할 것은 없다. 스크립트가 Chrome을 헤드리스로 띄워 DevTools 프로토콜로 조작한다.
**kind 시험 중에도 돌릴 수 있다.** 전용 DB·전용 포트만 쓴다. 다만 Docker 메모리를 조금(PostgreSQL 컨테이너 하나) 더 쓴다.

서버는 `.claude/launch.json`의 `shots-*` 구성을 쓴다. env는 `scripts/screenshots/env/`에 있다. 앱은 빌드 산출물(`dist`)로 뜬다. 코드가 바뀌었으면 먼저 `npm run build`를 한다.
Claude 데스크톱의 미리보기는 서버를 5개까지만 띄울 수 있다. 그래서 단계마다 워커를 내리고 올린다.

```
1. bash scripts/screenshots/prepare.sh db              # 서버를 모두 내린 상태에서
2. 띄우기: shots-central · shots-admission · shots-scanner · shots-relay · shots-web
3. bash scripts/screenshots/prepare.sh policy
4. node scripts/screenshots/capture.mjs applicant       # 01~14
5. shots-central 내림 → capture.mjs central-down (15~17) → shots-central 띄움
6. shots-admission 내림 → capture.mjs admission-down (18~19) → shots-admission 띄움
7. shots-relay 내림 → capture.mjs seed-recon → prepare.sh recon → prepare.sh config
8. shots-scanner 내림 → shots-admin 띄움 → capture.mjs admin (20~27)
9. 모두 내리고 docker rm -f ui-shots-pg
```

단계 사이에 이어 쓰는 원서 ID와 실패 화면(`fail-<단계>.png`)은 `%TEMP%/wonseoro-shots/`에 남는다.
업로드한 샘플 PDF는 로컬 MinIO의 `ui-shots-documents` 버킷에 쌓인다.
