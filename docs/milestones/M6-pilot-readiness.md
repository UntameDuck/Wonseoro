# M6 — Pilot 준비

| | |
|---|---|
| **목표** | 실제 대학 1곳과 Shadow Test를 할 수 있는 상태로 만든다 |
| **완료 기준** | 대학 1곳 Shadow Test 가능 — 실 전형 Schema·실 PG Sandbox·운영 런북 완비 |
| **선행 조건** | M5 종료 체크리스트 완료 |
| **주 담당** | 공동 (외부 협력이 주 변수) |

> 이 단계부터는 **기술보다 협력이 병목**이다.
> 개발보고서가 명시한 대로, 2인 학생팀이 전국 상용 운영을 하겠다고 주장하지 않는다.
> 팀이 직접 검증할 범위와 파트너가 필요한 범위를 분리한다.

## 노션 확인 대상

| 문서 | 이 단계에서 보는 이유 |
|---|---|
| [v1.0 §14 운영계획](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 역할 분담, 연간 운영주기 D-180~D+30, Incident Severity |
| [v1.0 §16 테스트·인수 기준](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 필수 시험 18종 |
| [v1.0 §17·§18](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 개인정보 처리구조, 대학별 배포 Profile |
| [v1.0 §19 Compliance Matrix](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 요구영역별 구현 대조 |
| [01. 운영 리스크](https://app.notion.com/p/3df75ab5debe813c87fceef73f0d74e8) | A8(Multi-cloud 구현차이) · B11(고객센터 폭주) |

## 태스크

> **2026-10-03 작업 기록** — 노션 원본을 다시 확인했다(운영 리스크 페이지 최종 편집 2026-09-27 18:37 KST, 기술설계서 2026-09-27 21:22 KST). 저장소 문서와 T-M6-01·06·07의 인수기준을 바꾸는 새 내용은 없었다. T-M6-01 완료: 기존 고급 JSON 편집은 보존하고, 전형·항목·서류를 사람 말로 구성해 같은 Config를 만드는 구조화 온보딩 화면을 추가했다. 빈 Config 생성, 알 수 없는 기존 Schema 키 보존, 화면 선검사 뒤 서버 Config Linter·2인 승인·호환 시험으로 이어진다. 관리자 빌드·문구 검사와 접근성 1280/320px(각 9화면, 문제 0) 통과.
>
> **2026-10-04 작업 기록** — T-M6-06 완료(D-78): 대학 DB의 추가 전용 장애 원장, 공개 상태 API, 지원자 전역 배너·`/status`, 운영자 발행/해제 화면을 연결했다. 운영 변경은 operator 권한·Step-up·멱등 키·감사 체인을 거치며 삭제나 본문 수정은 허용하지 않는다. OpenAPI 1.8.0, DB 제약 22종, admission-api 382개(379 pass·3 skip·0 fail), 두 앱 빌드·화면 문구 검사, 상태 화면과 관리자 화면 1280/320 접근성 문제 0을 확인했다. 사용량 11% 시점에 새 작업을 멈췄으며 T-M6-07은 미착수다([17](../17-pilot-support-tools.md)).
>
> **2026-10-04 작업 기록 (2)** — T-M6-07 완료(D-79): 상담원은 이름·연락처가 아니라 접수번호·상담 확인번호(원서마다 DB 가 만드는 10자)로 찾고, 응답은 허용 목록(상태·시각·결제/서류 요약·중앙 반영·안내 문장)으로만 만든다. 조회마다 증적번호(`SR-YYYYMMDD-XXXXXX`)와 그 순간 응답·해시를 추가 전용 기록에 남기고 원서 감사 체인에 잇는다. 새 역할 `support-agent`·범위 `support`, OpenAPI 1.9.0, DB 제약 23종, admission-api 388개(385 pass·3 skip·0 fail), 관리자 1280/320 각 13화면·지원자 1280/320 각 20화면 접근성 문제 0. **Pilot 지원 도구의 AI 몫 끝**([17](../17-pilot-support-tools.md)).
>
> **2026-10-04 작업 기록 (3)** — 남은 사람·기관 태스크의 실행 전 준비를 [18](../18-pilot-execution-package.md)로 묶었다. 노션 §14·16·19를 다시 읽어 SEV1 11단계, 운영주기 9구간, 필수 시험 18종, Compliance 10개 영역을 고정했고 War-room·영향평가·Shadow 실행 절차를 연결했다. `npm run ops:pilot-readiness`는 승인·실행 증적과 시험 건너뜀 수가 빠지면 종료 코드 1이다. **대학 승인·훈련·실증은 하지 않았으므로 T-M6-08·09·10·12·13·15는 미완료 그대로다.**
>
> **2026-10-04 작업 기록 (4)** — 실 PG 계약 뒤 T-M6-04·05를 닫을 수용 게이트를 준비했다. `npm run ops:pg-sandbox-acceptance`는 실제 `pg-sandbox`, 대학·PG 승인, 결제 9종·정산 5종, 건너뜀 0건, 사후 예외 0건과 재현 가능한 증적을 요구하며 Mock 결과를 거절한다. 단위시험 3개 통과·실패 0·건너뜀 0, 빈 양식은 결제 0/9·정산 0/5로 의도대로 실패했다. **PG 사업자·실계정·어댑터가 없으므로 T-M6-04·05는 미완료 그대로다.**

| ID | 태스크 | 담당 | 근거 노션 | 인수기준 |
|---|---|---|---|---|
| T-M6-01 | 전형 Schema 온보딩 도구 | 송리안 | §01 A5 | 신규 대학 추가가 Config만으로 가능 — ✅ 2026-10-03 구조화 전형·문항·서류 편집 + 빈 Config 시작 |
| T-M6-02 | Config Linter + Compatibility Test | 송리안 | §01 A5 | 잘못된 Config가 Production 반영 불가 — ✅ 2026-10-03 진행 중 원서 호환 시험·적용 거절(D-77) |
| T-M6-03 | CSP Conformance Preflight | 송리안 | §01 A8 | StorageClass·IngressClass·KMS·LB capability 검사 — ✅ 2026-10-03 `scripts/ops/csp-preflight.mjs`([14](../14-operations-automation.md)) |
| T-M6-04 | 실 PG Sandbox 연동 | 송리안 | v1.0 §5.5 | Mock Provider를 Adapter 교체만으로 대체 — 결제·콜백·복구 9종 수용 게이트 준비, 계약 PG·실행 대기([18 §8.1](../18-pilot-execution-package.md#81-t-m6-0405--실-pg-sandbox-수용-게이트)) |
| T-M6-05 | PG Reconciliation 실계정 검증 | 송리안 | §01 B4 | 정산 대조 — 일치·로컬만·PG만·상태/금액 불일치 5종과 사후 예외 0건 게이트 준비, 실계정 대기([18 §8.1](../18-pilot-execution-package.md#81-t-m6-0405--실-pg-sandbox-수용-게이트)) |
| T-M6-06 | Status Page + 대학별 Incident Banner | 권민준 | §01 B11 | 장애 시 고객센터 폭주 완화 — ✅ 2026-10-04 대학별 장애 원장·공개 상태 API·전역 배너·운영자 발행/해제(D-78, OpenAPI 1.8.0) |
| T-M6-07 | PII 최소 Support View | 권민준 | §01 B11 | 상담원이 원서 본문을 못 보게 — ✅ 2026-10-04 접수번호·상담 확인번호 조회, 허용 목록 응답, 자동 증적번호·감사 체인(D-79, OpenAPI 1.9.0) |
| T-M6-08 | 운영 런북 (SEV1~3) | 공동 | v1.0 §14.3 | Detect→IC 지정→변경동결→격리→Failover→통보→공지→증적보존→복구검증→Reconciliation→Postmortem — 실행 초안·증적 게이트 준비, 기관 승인 대기([18](../18-pilot-execution-package.md)) |
| T-M6-09 | 연간 운영주기 캘린더 | 공동 | v1.0 §14.2 | D-180~D+30 체크리스트 — 9구간 양식·게이트 준비, 기관 일정·책임자 확정 대기([18](../18-pilot-execution-package.md)) |
| T-M6-10 | War-room 훈련 시나리오 | 공동 | v1.0 §14.2 | D-7~1 운영자 훈련 — 5개 상황 주입 준비, 실제 훈련 대기([18](../18-pilot-execution-package.md)) |
| T-M6-11 | 개인정보 처리흐름도 | 송리안 | v1.0 §17 | 위탁·Subprocessor 목록 — ✅ 2026-10-03 [15](../15-privacy-data-flow.md) |
| T-M6-12 | 영향평가 체크리스트 | 송리안 | v1.0 §2.2 | 대상 여부 사전판정 — 질문·승인 양식 준비, 대학 개인정보 담당 판정 대기([18](../18-pilot-execution-package.md)) |
| T-M6-13 | Compliance Matrix 실증 | 공동 | v1.0 §19 | 10개 요구영역 대조표 — 저장소 후보 증적 연결·게이트 준비, 기관 판정 대기([18](../18-pilot-execution-package.md)) |
| T-M6-14 | 대학 Onboarding 문서 | 공동 | — | 입학처·정보화부서가 읽을 수 있는 수준 — ✅ 2026-10-03 [16](../16-university-onboarding.md) |
| T-M6-15 | Shadow Test 계획서 | 공동 | 개발보고서 3단계 | 비수기 Sandbox→Shadow→제한 Pilot — 단계별 진입·종료·중단 기준과 증적 양식 준비, 대학 실행 대기([18](../18-pilot-execution-package.md)) |

## 상용화 협력 범위 (개발보고서 기준)

**팀이 직접 검증할 범위 / 파트너가 필요한 범위를 섞지 않는다.**

| 영역 | 필요 파트너 | 팀이 직접 검증할 범위 |
|---|---|---|
| 입학업무 | 대학 입학처·대교협 | 전형 Schema·마감정책·관리자 Flow Prototype |
| 결제·정산 | 대학 계약 PG사 | Sandbox Adapter·Callback·Reconciliation |
| 클라우드·운영 | K-PaaS/CSP·SRE | Helm 배포·부하/장애시험·관측성 기준 |
| 개인정보·보안 | 대학 정보보호조직·전문가 | Threat Model·RBAC·감사·보존정책 설계와 시험 |

## 종료 체크리스트

- [ ] 신규 대학 1곳을 **코드 수정 없이** Config만으로 추가 가능
- [ ] 실 PG Sandbox로 결제~정산 대조 성공
- [ ] SEV1 런북대로 모의 장애 대응 훈련 완료
- [ ] v1.0 §16 필수 시험 18종 전부 수행 기록 확보
- [ ] Compliance Matrix 10개 요구영역 대조 완료
- [ ] **노션 §14·§16·§17·§19를 다시 읽고** Pilot 실제 요구사항 반영
- [ ] Pilot 대학 피드백을 전형 Schema·UX 설계에 반영하고 노션 갱신
- [ ] 발견한 불일치를 D-N으로 등록·처리
- [ ] Pilot 결과로 Self-Hosted·Co-Managed·Fully Managed Dedicated 가격·SLA 확정 (개발보고서 4단계)
