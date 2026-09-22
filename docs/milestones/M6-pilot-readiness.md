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

| ID | 태스크 | 담당 | 근거 노션 | 인수기준 |
|---|---|---|---|---|
| T-M6-01 | 전형 Schema 온보딩 도구 | 송리안 | §01 A5 | 신규 대학 추가가 Config만으로 가능 |
| T-M6-02 | Config Linter + Compatibility Test | 송리안 | §01 A5 | 잘못된 Config가 Production 반영 불가 |
| T-M6-03 | CSP Conformance Preflight | 송리안 | §01 A8 | StorageClass·IngressClass·KMS·LB capability 검사 |
| T-M6-04 | 실 PG Sandbox 연동 | 송리안 | v1.0 §5.5 | Mock Provider를 Adapter 교체만으로 대체 |
| T-M6-05 | PG Reconciliation 실계정 검증 | 송리안 | §01 B4 | 정산 대조 |
| T-M6-06 | Status Page + 대학별 Incident Banner | 권민준 | §01 B11 | 장애 시 고객센터 폭주 완화 |
| T-M6-07 | PII 최소 Support View | 권민준 | §01 B11 | 상담원이 원서 본문을 못 보게 |
| T-M6-08 | 운영 런북 (SEV1~3) | 공동 | v1.0 §14.3 | Detect→IC 지정→변경동결→격리→Failover→통보→공지→증적보존→복구검증→Reconciliation→Postmortem |
| T-M6-09 | 연간 운영주기 캘린더 | 공동 | v1.0 §14.2 | D-180~D+30 체크리스트 |
| T-M6-10 | War-room 훈련 시나리오 | 공동 | v1.0 §14.2 | D-7~1 운영자 훈련 |
| T-M6-11 | 개인정보 처리흐름도 | 송리안 | v1.0 §17 | 위탁·Subprocessor 목록 |
| T-M6-12 | 영향평가 체크리스트 | 송리안 | v1.0 §2.2 | 대상 여부 사전판정 |
| T-M6-13 | Compliance Matrix 실증 | 공동 | v1.0 §19 | 10개 요구영역 대조표 |
| T-M6-14 | 대학 Onboarding 문서 | 공동 | — | 입학처·정보화부서가 읽을 수 있는 수준 |
| T-M6-15 | Shadow Test 계획서 | 공동 | 개발보고서 3단계 | 비수기 Sandbox→Shadow→제한 Pilot |

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
