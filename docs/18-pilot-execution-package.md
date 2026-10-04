# Pilot 운영·검증 실행 패키지

> 기준일: 2026-10-04 · 대상: T-M6-08·09·10·12·13·15와 M6 종료 판정
>
> **상태: 실행 전 초안.** 저장소가 절차·양식·자동 판정을 준비했을 뿐, 대학·PG·CSP·개인정보 담당자의 승인이나 실제 훈련을 대신하지 않았다. 이 문서만으로 어떤 태스크도 완료 처리하지 않는다.

## 1. 목적과 판정 원칙

Pilot 진입 전 해야 할 일을 회의 메모가 아니라 다시 검증할 수 있는 증적으로 남긴다. 대학·전형별로 [빈 증적 파일](../deploy/pilot/pilot-readiness.example.yaml)을 복사해 채우고 다음 명령이 성공해야 한다.

```powershell
npm run ops:pilot-readiness -- --file=deploy/pilot/<대학>-<전형>.yaml
```

판정기는 사람이 적은 `passed: true`를 믿지 않는다. 정해진 행이 모두 있는지, 상태가 승인·통과·완료인지, 환경·시각·건너뜀 수와 증적 참조가 있는지를 다시 계산한다. 비밀·개인 연락처·지원자 정보는 넣지 않고 통제된 원본의 경로나 티켓 번호만 넣는다.

설계 원본은 노션 [기술설계서 v1.0 §14·§16·§19](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65)이며, 운영 위험 보완은 [v1.1 §01](https://app.notion.com/p/3df75ab5debe813c87fceef73f0d74e8)이다. 2026-10-04 다시 읽었고 아래 기준과 충돌하는 내용은 없었다.

### 실행 게이트 빠른 색인

| 범위 | 명령 | 시작 양식 | 완료 태스크 |
|---|---|---|---|
| Pilot 전체 | `ops:pilot-readiness` | `pilot-readiness.example.yaml` | T-M6-08·09·10·12·13·15 |
| M Profile 부하 | `ops:load-acceptance` → `ops:load-campaign-acceptance` | `load-campaign.example.yaml` | T-M4-30·31·32·36·41 |
| PostgreSQL HA/PITR/DR | `ops:ha-preflight` → `ops:dr-acceptance` | `dr-acceptance.example.yaml` | T-M4-06·T-M5-60·61·64 |
| Edge 노드 장애 | `ops:edge-failover-acceptance` | `edge-failover-acceptance.example.yaml` | T-M4-39 |
| 실 PG Sandbox | `ops:pg-sandbox-acceptance` | `pg-sandbox-acceptance.example.yaml` | T-M6-04·05 |
| 실물·수동 접근성 | `ops:manual-accessibility-acceptance` | `manual-accessibility.example.yaml` | T-M5-47·48 |

양식은 모두 `deploy/pilot/`에 있다. 빈 예시는 의도적으로 실패한다. 판정기 단위시험 8종은 `npm run test:ops:external-gates`로 한 번에 실행한다.

## 2. 시작 전에 기관이 채울 것

| 항목 | 책임 | 저장소에 남길 것 | 저장소에 넣지 않을 것 |
|---|---|---|---|
| 대학·전형·접수 시작일 | 입학처 | 식별자, 전형 주기, 기준일 | 지원자 명단 |
| 비상 역할 7종 | 대학+운영 | 조직·역할명, 연락망 문서 참조 | 개인 휴대전화·비밀번호 |
| PG·본인확인·CSP 계약 | 대학 | 계약/티켓 참조, 시험 환경 ID | API 키·인증서 개인키 |
| 개인정보 영향평가 사전판정 | 개인정보 담당 | 대상/비대상, 판단 근거, 승인 참조 | 주민번호·민감정보 표본 |
| 증적 저장 위치 | 보안·감사 | 읽기 통제된 경로와 보존정책 | 공개 링크 |

기관이 정하지 않은 값은 추정하지 않는다. `pending`, 빈 값, 빈 증적은 정상적인 준비 중 상태이며 게이트가 실패해야 맞다.

## 3. T-M6-08 — SEV1~3 운영 런북

### 3.1 등급과 선언

| 등급 | 설계 기준 | 첫 행동 | 종료 권한 |
|---|---|---|---|
| SEV1 | 최종제출 불가, 데이터 정합성 위험, 전체 또는 개별 대학 대규모 장애 | IC 지정·변경동결·영향 대학 격리 | IC + 입학처 업무책임자 |
| SEV2 | 일부 기능 장애, 높은 오류율, 결제 지연 | 당직 책임자 지정·영향범위 확인·사용자 안내 판단 | 당직 책임자 + 서비스 책임자 |
| SEV3 | 비핵심 기능 저하 | 업무시간 처리, 악화 조건 감시 | 서비스 책임자 |

등급을 낮춰 시작하지 않는다. 최종제출 여부나 정합성이 불명확하면 SEV1로 선언한 뒤 증거로 낮춘다. 개인정보 침해 가능성이 있으면 SOC와 개인정보 담당을 즉시 부르고, 통지·신고 시계와 법적 범위는 해당 기관 담당자가 확정한다.

### 3.2 역할

| ID | 역할 | 책임 |
|---|---|---|
| `incident-commander` | Incident Commander | 우선순위·등급·변경동결·복구 종료 결정 |
| `university-admissions` | 대학 입학처 | 접수 연장·업무 안내·최종 데이터 책임 |
| `sre-noc` | SRE/NOC | 관측·격리·확장·Failover·복구 검증 |
| `soc-security` | SOC/보안 | 침해 판단·증적 보전·보안 통보 경로 |
| `privacy` | 개인정보 담당 | 영향평가·정보주체/기관 통지 판단 |
| `helpdesk` | Helpdesk | 공지·문의 분류·상담 증적번호 연결 |
| `pg` | PG 연락 책임 | 승인·취소·정산 상태 확인 |

각 역할은 주 담당, 대체 담당, 비상연락망 참조가 모두 있어야 승인된다. 개인 연락처는 별도 통제 문서나 Vault에 두며 Git에는 참조만 둔다.

### 3.3 SEV1 11단계

| 단계 | 반드시 할 일 | 다음 단계 조건 | 남길 증적 |
|---|---|---|---|
| 1 Detect | 최초 경보 시각·증상·대학·전형·사용자 영향·관측 출처 기록 | 실제 영향 또는 정합성 위험을 한 문장으로 설명 | 경보 ID, 대시보드 시각, 최초 티켓 |
| 2 IC 지정 | 주/대체 담당 중 한 명이 IC 수락, 기록 담당 별도 지정 | 채널·티켓·다음 갱신 시각 공지 | IC 수락 시각·참여 역할 |
| 3 변경동결 | GitOps·설정·마감·일반 배포 중지, 진행 중 변경 목록 확보 | SEV1 대응 변경만 IC 승인 | 동결 선언, 진행 중 변경·digest |
| 4 장애격리 | 대학별 경계, 외부 의존성, 쓰기 경로 중 가장 작은 범위 격리 | 다른 대학·원본 데이터로 전파되지 않음 | 격리 전후 오류율·재시작·큐 |
| 5 Failover/Scale | 승인된 경로만 사용. DB면 기존 Writer fencing 뒤 승격, API면 사전 정의 규모로 확장 | 단일 Writer·Ready·핵심 요청 성공 | 명령/변경 티켓, writer epoch, 배포 revision |
| 6 대학 통보 | 입학처·정보화부서에 사실·영향·다음 갱신 시각 전달 | 업무 판단권자가 접수 연장 필요성 검토 | 통보 시각·수신 역할·결정 번호 |
| 7 사용자 공지 | 확인된 사실만 상태 페이지·대학별 배너에 게시 | 지원자가 재결제·중복 제출하지 않도록 행동 안내 | 장애 공지 ID·게시/해제 시각 |
| 8 증적보존 | 로그 보존, 감사 체인·배포·정책·PG·DB 시각을 읽기 전용으로 고정 | 사건 시간축 재구성 가능 | 증적 묶음 ID·hash·보존 위치 |
| 9 복구검증 | 새 요청 성공뿐 아니라 기존 원서·결제·서류·접수번호 확인 | 정합성 invariant·오류율·SLO 확인 | 점검 결과, 건너뜀 수, 실패 목록 |
| 10 Reconciliation | Application·Payment·Submission·Central ACK 4-way 대조, 예외 큐 처리 | 미해결 건의 소유자·기한이 모두 있음 | 대조 결과·예외 건수·담당 티켓 |
| 11 Postmortem | 사실 시간축·근본원인·탐지/대응 간격·재발방지 작성 | 후속 항목마다 소유자·기한·검증법 있음 | 승인된 회고·후속 티켓 |

DB 전환은 `pg_promote()` → 새 Primary의 `promote_writer(세대+1, 행위자)` → GitOps `database.writerEpoch` 변경 순서다. 그 사이 쓰기는 실패하는 쪽이 맞다. 기존 Writer fencing 확인 없이 DNS나 Edge만 바꾸지 않는다. 복구 뒤에는 `npm run ops:restore-verify`와 운영 Reconciliation을 각각 실행한다. 전자는 복구본 정합성, 후자는 실제 원서·결제·중앙 상태를 확인하므로 서로 대신할 수 없다.

## 4. T-M6-09 — D-180~D+30 운영주기

| ID | 기간 | 완료해야 하는 것 | 최소 증적 |
|---|---|---|---|
| `d-180~120` | D-180~120 | 새 전형연도 Schema·정책, 대학 온보딩 범위 확정 | 승인된 전형 목록·RACI |
| `d-120~60` | D-120~60 | 대학 Config, PG·인증·대교협 연계 시험 | Config 판, Sandbox 거래·연계 결과 |
| `d-60~30` | D-60~30 | E2E·접근성·실물 브라우저·보안약점 진단 | 실행 환경·결과·건너뜀 수 |
| `d-30~14` | D-30~14 | 실제 예상 부하 2배 이상 Load/Soak, DB 튜닝 | 부하 모델·원시 결과·변경 전후 |
| `d-14~7` | D-14~7 | DR·백업 복구·중앙 단절 훈련 | RTO/RPO·event loss·복구 검증 |
| `d-7~1` | D-7~1 | Freeze·사전 확장·War-room·연락망 확인 | 동결 선언·용량 값·훈련 기록 |
| `admission` | 접수기간 | 24×7 On-call, 대학·중앙 합동 감시 | 교대표 참조·인수인계·장애 기록 |
| `d+1~7` | D+1~7 | 결제·접수·중앙 Event 대조, 사후 검증 | 4-way 대조·예외 큐 처리 |
| `d+7~30` | D+7~30 | Postmortem·용량 모델·보안 Patch | 승인 회고·다음 연도 변경 목록 |

각 구간은 달력에 있다는 이유로 완료되지 않는다. 책임자와 실제 결과 참조가 있어야 `completed`다.

## 5. T-M6-10 — War-room 훈련

### 5.1 훈련 조건

- D-7~1에 운영과 분리된 환경에서 진행한다.
- 진행자만 상황 주입 순서를 알고, IC는 운영 연락망에서 호출한다.
- 실 지원자 정보·실 결제·실 통지 채널을 쓰지 않는다.
- 모니터링 화면, 상태 페이지, 상담 화면, Reconciliation, Writer fencing을 실제 조작 경로로 확인한다.
- 장애를 흉내 낸 시각과 운영자가 처음 알아챈 시각을 따로 남긴다.

### 5.2 필수 상황 주입

| ID | 주입 | 관찰할 것 | 합격 조건 |
|---|---|---|---|
| `finalization-outage` | 최종제출 오류율 급증 | SEV1 선언·변경동결·입학처 호출 | IC와 다음 갱신 시각이 기록됨 |
| `payment-delay` | PG 승인 확인 지연·콜백 유실 | 재결제 금지 안내·UNKNOWN/재조회·정산 대조 | 중복 결제/접수 0, 예외 소유자 지정 |
| `db-failover` | Primary 손실 | 기존 Writer fencing·세대 증가·새 Writer | 동시 Writer 0, 중복 FINALIZED 0 |
| `central-disconnect` | 중앙 2시간 단절 상황 | 대학 접수 지속·Outbox 적체·복구 재전송 | Event loss 0, 다른 대학 영향 0 |
| `communications` | 문의 급증·부분 정보 | 상태 배너·Helpdesk 최소조회·정기 갱신 | PII 노출 0, 공지와 내부 사실 일치 |

훈련 종료 뒤 각 주입마다 관찰 결과와 증적을 따로 남긴다. 말로 “문제없음”만 남긴 기록은 게이트가 받지 않는다.

## 6. T-M6-12 — 개인정보 영향평가 사전판정

이 절은 법무의 최종 판단을 대신하지 않는다. 노션 v1.0 §2.2의 설계 기준에 따라 개인정보 담당자가 검토할 질문을 빠뜨리지 않게 한다.

1. 대학이 공공기관에 해당하는가, 사립대라면 자율 영향평가 범위를 어디까지 적용하는가?
2. 고유식별정보 또는 민감정보를 처리하는 개인정보파일의 정보주체 수가 5만 명 이상인가?
3. 다른 개인정보파일과 연계한 결과가 50만 명 이상인가?
4. 하나의 개인정보파일에서 처리하는 정보주체가 100만 명 이상인가?
5. 기존 영향평가 대상 시스템의 수집 항목·이용 목적·보유기간·연계·제3자 제공·위탁·인프라가 바뀌는가?
6. 대학별 Data Plane, 중앙 최소 이벤트, PG·본인확인·Object Storage·관제의 처리 경계와 국외 이전 여부가 문서 15와 일치하는가?
7. 대상이면 평가 일정·평가기관·개선조치가 접수 시작 전에 끝나는가? 비대상이면 판단 근거와 승인자가 있는가?

결과는 `required` 또는 `not-required` 중 하나여야 한다. 둘 다 근거와 개인정보 담당자 승인이 필요하며, `not-required`는 “검토 안 함”을 뜻하지 않는다. 도입 시점의 법령·기관 규정은 담당자가 다시 확인한다.

## 7. T-M6-13 — Compliance 10개 영역

| ID | 요구영역 | 저장소의 기존 후보 증적 | 기관이 추가로 판정할 것 |
|---|---|---|---|
| `krds` | KRDS | `packages/krds`, 화면 42장 | 대학 브랜드 변경 뒤 패턴 유지 |
| `kwcag-wcag` | KWCAG/WCAG | `docs/09-accessibility.md`, `tests/a11y/results` | 실제 스크린리더·보조기기 수동 검사 |
| `web-compatibility` | 웹 호환성 | 두 앱 `browserslist`, UTF-8 계약 시험 | 실물 Firefox·Safari, 기관 브라우저 정책 |
| `secure-development` | SW 개발보안 | `docs/11-security-pipeline.md`, Security Actions | 기관 모의해킹·잔여 위험 승인 |
| `privacy-safeguards` | 개인정보 안전조치 | `docs/13-security-controls-plan.md`, 감사·암호화 시험 | 운영 키·접속기록·권한 검토 실제 설정 |
| `isms-p` | ISMS-P | 보안 통제·개인정보 흐름 문서 | 인증 대상 여부와 기관 통제 매핑 승인 |
| `kcmvp` | KCMVP | `ops:csp-preflight`의 사람 확인 항목 | 국가·공공 요구 여부와 검증필 모듈 증명 |
| `csap` | CSAP | CSP 사전 점검 결과 | 적용 대상·CSP 인증 범위·서비스 등급 |
| `stability-notice` | 안정성 고시 | `docs/14-operations-automation.md`, 복구·장애 결과 | 기관 등급·SLA·실 DR 훈련·보고체계 |
| `service-quality` | 서비스 품질 | SLO/KPI 대시보드·상태/상담 화면 | 계약 KPI·고객지원·장애처리 기준 |

각 행은 `compliant` 또는 `not-applicable`로 판정한다. 비대상도 책임자·근거·증적이 필요하다. 저장소에 구현이 있다는 사실만으로 운영 적합을 선언하지 않는다.

## 8. 노션 §16 필수 시험 18종

| ID | 시험 | 현재 재사용할 수 있는 것 | Pilot에서 필요한 추가 실행 |
|---|---|---|---|
| `unit` | Unit Test | `npm test` | Pilot 후보 commit에서 재실행, skip 보고 |
| `api-contract` | API Contract | `npm run check:contracts` | PG·대학 연계 계약 포함 확인 |
| `db-migration` | DB Migration | CI DB·제약 시험 | 운영과 같은 PostgreSQL 판·복제 구조 |
| `payment-sandbox-e2e` | Payment Sandbox E2E | Mock PG 흐름 | 계약 PG Sandbox 실거래·취소·콜백 |
| `browser-compatibility` | Browser Compatibility | Chrome·Edge·모바일 흉내 | 실물 Firefox·Safari |
| `kwcag-manual` | KWCAG Manual | 자동 접근성 결과·대본 | 실제 스크린리더·확대·음성 입력 |
| `sast-sca-secret` | SAST/SCA/Secret | Security workflow | 후보 commit 결과와 예외 승인 |
| `dast-penetration` | DAST/Penetration | ZAP gate | Pilot 환경 DAST·기관 모의해킹 |
| `container-iac-scan` | Container/IaC | 이미지·SBOM·서명·Admission 검사 | 배포 digest와 CSP 정책 결과 |
| `load` | Load | `tests/load/k6-admission.js` 원본 + `k6-acceptance.js` 실행 프로필 | M Profile 500·1,500·3,000 동시와 1,000 RPS Burst 실제 실행 |
| `soak-6h` | 6시간 Soak | `k6-acceptance.js` 6시간 프로필·OIDC 갱신·사후 DB 게이트 | 외부 환경 실행·메모리/커넥션 추세 판정 |
| `finalization-burst` | Finalization Burst | 동시 Finalize 100회 | Pilot 용량에서 집중구간 실측 |
| `pod-node-chaos` | Pod/Node Failure | kind 축소 결과 | K-PaaS Edge 재시도 포함 판정 |
| `db-failover` | DB Failover | `ops:ha-preflight` 역할·동기복제·WAL·writer token 사전 점검 + `failover-70` 프로필·writer epoch/DB 정합성 게이트 | 70% 부하 중 실제 HA 전환 |
| `central-disconnect` | Central Disconnect | 로컬 2시간 실증 | Pilot 네트워크·mTLS 경로 재확인 |
| `pg-timeout` | PG Timeout | Mock 1~30분 실증 | 실 PG Sandbox 지연·대조 |
| `backup-restore` | Backup Restore | `npm run ops:restore-verify` | PITR/WAL 백업에서 별도 환경 복구 |
| `dr-switch` | Full DR Switching | Writer fencing·절차 | 원격지 전환 RTO/RPO 실측 |

각 결과에 환경, 실행 시각, 건너뜀 수, 원시 증적을 기록한다. “시험 통과”는 건너뜀을 숨기는 표현으로 쓰지 않는다.

### 8.1 T-M6-04·05 — 실 PG Sandbox 수용 게이트

PG 사업자·가맹점 Sandbox 계정·어댑터가 정해지기 전에는 벤더 API 형식이나 성공 수치를 추정하지 않는다. 정해진 뒤 [빈 PG 증적 파일](../deploy/pilot/pg-sandbox-acceptance.example.yaml)을 대학별로 복사해 다음 명령으로 판정한다.

```powershell
npm run ops:pg-sandbox-acceptance -- --file=deploy/pilot/<대학>-pg-sandbox.yaml
```

| 구분 | 필수 시험 ID | 확인할 사실 |
|---|---|---|
| 결제 생성 | `intent-unique` | 서로 다른 요청이 서로 다른 PG 거래를 만들고, 같은 원서의 결제창 재개는 새 거래를 만들지 않음 |
| 서버 확인 | `server-verification`·`amount-verification` | 클라이언트·콜백의 성공 문구를 믿지 않고 서버가 PG 상태와 금액을 다시 확인 |
| 콜백 | `invalid-callback-signature`·`callback-server-reverification`·`callback-replay` | 잘못된 서명 거절, 유효 콜백 뒤 서버 재조회, 같은 이벤트 재전송의 멱등 처리 |
| 복구 | `closed-window-recovery`·`pending-unknown-retry` | 결제창을 닫거나 확인이 늦어도 재결제를 만들지 않고 워커가 최종 상태를 회복 |
| 취소 | `approved-cancellation` | 승인된 Sandbox 거래를 사람 승인 절차로 취소하고 PG·로컬 상태가 일치 |
| 정산 | `matched`·`local-only`·`provider-only`·`status-mismatch`·`amount-mismatch` | 정상 일치와 네 불일치 유형이 각각 대조 큐에서 검출·소유·해소됨 |

모든 행은 실제 실행 시각, 관찰 결과, 증적 참조, 거래 식별자 **집합의 SHA-256**, 건너뜀 수를 가진다. Mock PG는 거절하고 건너뜀은 0건만 허용한다. 마지막으로 미처리 정산 예외·중복 승인·승인 후 미접수 건이 모두 0인지 별도 증적으로 확인한다. 거래번호·가맹점 번호·키·토큰·콜백 비밀은 저장소에 넣지 않는다.

이 게이트를 준비했다는 사실은 T-M6-04·05 완료가 아니다. `PaymentProviderPort` 구현과 운영 선택값, 대학·PG 실행 승인, 실제 Sandbox 원장까지 있어야 한다.

### 8.2 T-M4-39 — CSP Edge·노드 장애 수용 게이트

로컬 다중 노드 kind는 zone 재배치와 Pod 복구를 검증했지만 관리형 Edge의 능동 헬스체크·재시도는 포함하지 않는다. 실제 CSP staging에서는 [빈 Edge 증적 파일](../deploy/pilot/edge-failover-acceptance.example.yaml)을 복사해 다음을 실행한다.

```powershell
npm run ops:edge-failover-acceptance -- --file=deploy/pilot/<대학>-edge-failover.yaml
```

안전한 읽기 메서드는 연결 실패·reset·unavailable에 제한된 횟수와 시도별 timeout으로 재시도한다. 쓰기는 멱등 키가 확인된 요청만 같은 범위에서 재시도하고, 그 밖의 쓰기는 재시도하지 않는다. 계획 정비와 워커 노드 강제 손실 중 요청을 계속 보내 다음을 모두 증명한다.

- 실제 Edge 재시도 횟수와 첫 시도 실패 수를 별도로 기록한다. 강제 손실에서 재시도 0건이면 시험이 장애 경로를 밟지 않은 것으로 본다.
- 최종 사용자 체감 실패와 중복 쓰기는 0건이어야 한다.
- 승인된 복구 목표와 관찰 복구 시간을 함께 남기고 목표를 넘으면 실패한다.
- 사후 DB·이벤트 대조에서 중복 접수, 이중 승인 결제, 미복구 이벤트 순번 공백이 모두 0이어야 한다.
- 서로 다른 zone 두 곳 이상과 Edge 능동 헬스체크 설정을 CSP 증적으로 남긴다.

이 결과가 성공하고 담당자가 Gateway 로그·Kubernetes 이벤트·DB 대조를 표본 확인한 뒤에만 T-M4-39의 🟡를 완료로 바꾼다.

### 8.3 T-M4-06·T-M5-60·61·64 — PITR·DR 수용 게이트

`ops:ha-preflight` 13/13은 실훈련의 진입 조건이다. 실제 완료 판정은 DB와 다른 장애영역에 소산한 기본 백업·WAL, 목표 시각 PITR, 부하 중 전환, Writer fencing, Failback, 사후 대조를 모두 필요로 한다. [빈 DR 증적 파일](../deploy/pilot/dr-acceptance.example.yaml)을 복사한다.

```powershell
npm run ops:dr-acceptance -- --file=deploy/pilot/<대학>-dr.yaml
```

판정기는 장애 시각→서비스 복구 시각으로 RTO를, 장애 시각→복구된 마지막 WAL 시각으로 RPO를 다시 계산한다. 노션 §10.3 기준인 RTO 15분·RPO 0~1분을 넘으면 실패한다. 다음도 모두 필요하다.

- Primary와 동기 Standby의 zone이 다르고, 백업은 두 DB와 다른 장애영역에 암호화해 소산한다.
- 목표 시각 PITR 복구본에 `ops:restore-verify`와 같은 행 수·체크섬·업무 불변식·DB 제약 검증을 건너뜀 없이 수행한다.
- 승인된 부하 중 Writer 세대를 정확히 1 올리고, 옛 Writer의 쓰기와 재합류 전 임의 쓰기를 거절한다.
- DNS/Edge를 새 Writer로 전환하고, 옛 Primary는 현재 Writer에서 다시 만든 뒤 Failback을 완료한다.
- 유실된 커밋·중복 접수·이중 승인 결제·미복구 이벤트 순번 공백·미처리 대조 예외가 모두 0이다.

성공 JSON만으로 자동 완료하지 않는다. SRE·DBA·입학처가 백업 객체 보존·Kubernetes/DB 이벤트·원시 부하 결과·대조 큐를 표본 확인하고 승인한 뒤 M4/M5 태스크를 갱신한다.

### 8.4 T-M4-30·31·32·36·41 — M Profile 부하 캠페인 종료 게이트

개별 `ops:load-acceptance`가 k6 threshold와 DB 정합성을 판정한 뒤 [빈 캠페인 파일](../deploy/pilot/load-campaign.example.yaml)에 다섯 결과 경로를 연결한다.

```powershell
npm run ops:load-campaign-acceptance -- --file=deploy/pilot/<대학>-load-campaign.yaml
```

게이트는 Baseline 500, Expected 1,500, Deadline 3,000 VU+1,000 RPS, 70% Failover 1,050 VU, 6시간 Soak 결과가 같은 환경·승인에서 실행됐는지 다시 확인한다. 각 결과의 합성 사용자 수와 실행시간, k6+DB 통과, Failover Writer 세대 검사를 읽으며 결과를 사람이 재입력하지 않는다. Soak 종료 때 API 메모리·DB 연결·Pool 대기·Outbox 지연·중앙 지연 추세가 승인 용량 안인지 책임자·원시 대시보드 증적을 요구한다.

이 게이트가 성공하고 원시 k6·DB·대시보드를 표본 확인한 뒤에만 다섯 부하 태스크를 완료 처리한다. D-90의 Finalize 150/300 TPS는 전체 지원 수·첫 처리/멱등 replay 분모가 결정되지 않아 이 캠페인에 포함하지 않는다.

### 8.5 T-M5-47·48 — 실물 브라우저·수동 접근성 게이트

자동 접근성 결과는 실제 보조기기 청취와 실물 브라우저 상호운용을 대신하지 않는다. [빈 수동 접근성 파일](../deploy/pilot/manual-accessibility.example.yaml)에 Windows Firefox·iPhone Safari의 지원자 접수, OIDC 로그인, 세션 대화상자, 키보드 포커스, 200% 확대/재배치, 파일 업로드를 각각 기록한다. 데스크톱/모바일 스크린리더·200% 확대·음성 입력도 실제 제품과 판, 관찰 결과, 증적을 남긴다.

```powershell
npm run ops:manual-accessibility-acceptance -- --file=deploy/pilot/<대학>-manual-a11y.yaml
```

브라우저 2/2·핵심 흐름 12/12·보조기기 4/4, 건너뜀 0, 차단/중대 결함 0이어야 한다. 경미 결함은 처분과 소유자를 남기고 대학 접근성 책임자가 최종 승인한다. 상세 대본과 판정법은 [접근성 문서](09-accessibility.md#실물수동-검사-실행-양식-2026-10-04)를 따른다.

## 9. T-M6-15 — Sandbox→Shadow→제한 Pilot

| 단계 | 데이터·외부 연계 | 진입 조건 | 종료 조건 |
|---|---|---|---|
| `sandbox` | 합성 데이터, PG Sandbox, 시험 IdP | Config Linter 경고 0, 계약·마이그레이션 통과 | 결제→접수→정산·권리 요청·장애 공지 E2E |
| `shadow` | 대학 승인 범위의 비운영 복제/합성 입력. 실제 개인정보가 필요하면 영향평가·법무 승인 선행 | 필수 시험과 런북 승인, 운영자 교육 | 대학 업무 결과와 플랫폼 결과 대조, 차이 소유자 지정 |
| `limited-pilot` | 대학이 정한 제한 대상·시간·용량 | Shadow 차이 해소, War-room·DR, 철회 기준 승인 | 성공 기준 충족, 잔여 위험 수용, 피드백 처리 |

Shadow는 생산 시스템에 결과를 쓰거나 실 PG 과금을 만드는 단계가 아니다. 읽기·복제 방식도 대학이 승인한 경계 안에서 정한다. 단계마다 승인자·완료 시각·증적이 있어야 하며, Pilot 피드백은 반영·거절·후속 중 하나로 처분하고 이유를 남긴다.

중단 기준은 다음을 최소로 포함한다.

- 원서·결제·접수 상태를 재구성할 수 없음
- 중복 FINALIZED 또는 단일 Writer 위반
- PII가 허용 경계를 벗어남
- 미승인 Config·마감·배포 변경
- 복구·대조되지 않은 PG 또는 중앙 이벤트 예외
- 접근성 수동 검사에서 접수 불가능한 차단 결함

## 10. 완료 처리

게이트가 성공해도 담당자가 원시 증적을 표본 확인한다. 그 뒤에만 다음 문서를 함께 갱신한다.

1. `docs/milestones/M6-pilot-readiness.md`의 해당 태스크와 종료 체크리스트
2. `docs/03-next-steps.md`의 전체 개수와 남은 B/C 목록
3. `docs/HANDOFF.md`의 현재 상태·실행 환경·실패/건너뜀 수
4. 노션 반영안 `docs/06-notion-changeset.md` — 페이지별 실제 쓰기는 사용자 확인 후

## 11. 출처

- [Wonseo 기술설계서 v1.0 §14·§16·§19](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) — 2026-09-27 21:22 KST 편집본을 2026-10-04 재확인
- [K-Admission v1.1 운영 리스크·설계 결함 분석](https://app.notion.com/p/3df75ab5debe813c87fceef73f0d74e8) — 2026-09-27 18:37 KST 편집본을 2026-10-04 재확인
- [대학 온보딩 안내](16-university-onboarding.md)
- [운영 자동화](14-operations-automation.md)
- [개인정보 처리흐름도](15-privacy-data-flow.md)
- [개인정보·법정 고지 차이](10-admission-privacy-and-legal-notices.md)
- [접근성 검증](09-accessibility.md)
