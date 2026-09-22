# M3 — 운영 안전장치

| | |
|---|---|
| **목표** | 실제 입시 운영에서 "장애가 나도 판정이 가능한" 상태로 만든다 |
| **완료 기준** | 노션 v1.1 §01 `E. 핵심 인수기준` 중 소프트웨어 항목 전부 통과 |
| **선행 조건** | M2 Demo Gate 통과 |
| **주 담당** | 송리안 (엔진·대조) / 권민준 (Admin Web) |

> v1.1 `D. 우선순위`의 **P0 상용운영 전 필수** 항목을 여기서 채운다.
> MVP는 돌아가지만, 이 단계 없이는 실제 대학에 넣을 수 없다.

## 노션 확인 대상

| 문서 | 이 단계에서 보는 이유 |
|---|---|
| [01. 운영 리스크](https://app.notion.com/p/3df75ab5debe813c87fceef73f0d74e8) | **이 단계의 주 설계서.** A2·A11·A14·B16·B17·B18, C 전체, D 우선순위, E 인수기준 |
| [03. OpenAPI](https://app.notion.com/p/3df75ab5debe81588b56fcd81e7b3856) | Admin API — Config·Deadline Policy·Reconciliation·Evidence |
| [v1.0 §9 감사로그](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 감사 이벤트 목록, hash-chain, WORM |
| [09. STRIDE](https://app.notion.com/p/3df75ab5debe81e4bff5f44e1e3112d4) | Repudiation·Tampering 대응이 이 단계 기능과 직결 |

## 진행 현황 (2026-09-23)

| 구분 | 태스크 |
|---|---|
| ✅ 완료 | T-M3-01 Deadline Policy Engine · T-M3-02 Configuration Governance |
| 🔜 다음 | T-M3-03 Audit hash-chain 분리 저장소 · T-M3-07 Evidence Package · T-M3-04 Reconciliation |

### §01 E 핵심 인수기준 "단독 운영자 1명으로 마감시간 변경 불가" 통과

실제로 막히는 것을 End-to-End 로 확인했다.

```
활성 정책 없음 → 마감 판정 거부                      503 (추측하지 않는다)
정책 초안 생성 (admin1)                              201
작성자 본인이 승인 시도                              403  ← 자기 변경을 혼자 통과시킬 수 없다
승인 1명만 받고 활성화 시도                          403
두 번째 담당자 승인                                  200  complete
과거 시각으로 예약 활성화                            400  ← 승인 절차 소급 우회 차단
정상 활성화                                          200
마감 판정 동작                                       정책버전 pol-2027-v1

Config 도 동일: 작성자 승인 403 / 승인 0명 활성화 403 / 2인 승인 후 ACTIVE
```

정책 변경 이력에 **누가 언제 승인·활성화했는지**와 `policy_hash` 가 남는다.
분쟁 시 "기억"이 아니라 이 기록으로 답한다. (§A2)

### 구현 중 확인한 DDL 결함 3건

| # | 내용 | 영향 |
|---|---|---|
| **D-21** | `config_version` 에 승인 관련 DB 제약이 **없다** | 승인 0명으로 ACTIVE 가능. 현재는 코드만 막는다 |
| D-22 | Deadline Policy 에 activate API 가 계약에 없다 | 승인과 활성화 분리(예약 활성화)가 불가능 |
| D-23 | `deadline_policy` 에 status·created_at 이 없다 | 초안 상태를 표현할 수 없어 문자열 규약으로 우회 |

### Diff 가 없으면 무슨 일이 생기는가 — 직접 겪었다

구현 검증 중 **빈 Config(`{"forms":{}}`)를 2인 승인 절차대로 활성화했다.**
절차는 전부 정상이었다. 승인 두 명, 활성화 성공.

그런데 그 순간 모든 전형의 추가문항 스키마가 사라졌다.
화면은 입력 항목이 하나도 없는 원서를 그렸고, 검증은 전부 통과했다.
**절차를 지켰는데 서비스가 망가졌다.**

§A14 가 2인 승인과 함께 **Diff** 를 요구하는 이유가 이것이다.
승인자가 "무엇이 바뀌는가"를 보지 못하면 두 명이 승인해도 사고를 막지 못한다.
T-M3-02 를 🟡 로 둔 이유이며, Diff·Rollback 이 붙어야 완료다.

**D-21 이 가장 중요하다.** §A14 가 2인 승인을 요구하는 마감시각·전형료·모집단위·
지원자격·PG 설정이 전부 `config_json` 에 들어가는데, DB 가 그것을 지키지 않는다.
코드는 우회 가능하고 DB 는 아니다.

## 태스크

| ID | 태스크 | 담당 | 근거 노션 | 인수기준 | 상태 |
|---|---|---|---|---|---|
| T-M3-01 | **Deadline Policy Engine** | 송리안 | §01 A2·C1 | 3개 룰 프로파일, 2인 승인, 정책버전, 경계값 검증 | ✅ |
| T-M3-02 | Configuration Governance | 송리안 | §01 A14·C5 | 2인 승인·예약 활성화. Diff·Rollback·Freeze 는 미구현 | 🟡 |
| T-M3-03 | Audit hash-chain + 분리 저장소 | 송리안 | §01 A11, v1.0 §9 | prevHash/eventHash, 운영자 삭제·수정 불가 |
| T-M3-04 | **Reconciliation Center (4-way)** | 송리안 | §01 A4·B18·C2 | Application/Payment/Submission/Central 대조 |
| T-M3-05 | Exception Queue + 수동 승인 복구 | 송리안 | §01 A4·B16 | 불일치만 큐로, 보정은 Admin Action API로만 |
| T-M3-06 | **Autonomous Mode** | 송리안 | §01 A1·C3 | Local Policy Snapshot·JWKS Cache·Offline Spool |
| T-M3-07 | Evidence Package 생성 | 송리안 | §01 A11·C6 | 상태 Timeline·정책·결제증적·config·clock·hash 검증 |
| T-M3-08 | Dependency Circuit Breaker | 송리안 | §01 C8 | PG/중앙/문자/메일 장애 전파 차단 |
| T-M3-09 | Purpose-scoped Token | 송리안 | §01 A12 | 중앙 토큰으로 원본 재식별 불가, key rotation |
| T-M3-10 | Retention Matrix + Policy Validation | 송리안 | §01 A15 | 법정·기관 기준보다 짧게 설정 불가 |
| T-M3-11 | Admin Web — Config 승인 화면 | 권민준 | §01 A14 | 단독 승인 불가가 UI에서 강제됨 |
| T-M3-12 | Admin Web — Reconciliation 콘솔 | 권민준 | §01 C2 | 불일치 목록·사유 입력·before/after |
| T-M3-13 | Admin Web — Evidence 조회 | 권민준 | §01 C6 | 특정 원서의 접수과정 재구성 |
| T-M3-14 | Deadline Extension Workflow | 공동 | §01 B17 | **권한은 입학처 정책담당.** 기술팀이 결정하지 않는다 |
| T-M3-15 | 마감연장 시 signed config version 생성 | 송리안 | §01 B17 | 연장 이력이 불변 기록으로 남음 |

## 태스크 상세

### T-M3-01 — Deadline Policy Engine

M1에서 "정책 객체를 읽는 구조"로 만들어둔 `deadline` 모듈을 실제 엔진으로 교체한다.

**3개 룰 프로파일** (§01 A2)
| 룰 | 인정 시점 | 사용 조건 |
|---|---|---|
| `FINALIZED_COMMIT_BEFORE_DEADLINE` | DB 커밋 시각 | **기본값** |
| `REQUEST_RECEIVED_BEFORE_DEADLINE` | 제출요청 수신 시각 | 업무규정이 명시한 경우만 |
| `PAYMENT_APPROVED_BEFORE_DEADLINE` | PG 승인 시각 | 업무규정이 명시한 경우만 |

- 정책은 입학처 **2인 승인** 후 활성화
- 모든 중요 응답에 `serverTime` · `deadlineAt` · `policyVersion` 포함
- `FINALIZE_REQUESTED` / `PAYMENT_APPROVED` / `FINALIZED` 시각을 **각각** 기록
- 정책 변경 이력은 불변 보관

**검증**: 마감 전후 ±5초, PG callback 지연 조합 자동 경계값 시험.

### T-M3-04 — Reconciliation Center

D+1에 네 가지를 대조한다 (§01 B18):
```
Application.status = FINALIZED
Payment.status     = CONFIRMED
Submission          존재
Central ACK         수신
```
전부 일치하면 통과, **불일치만** Exception Queue로 보낸다.

### T-M3-06 — Autonomous Mode

중앙 Control Plane·IAM·DNS·Registry가 끊겨도 **이미 접속한 사용자의 접수가 계속되어야 한다** (§01 A1).

- Local Policy Snapshot (서명된 전형정책·설정)
- Local JWKS Cache
- Offline Event Spool
- Central Dependency Health Gate
- **운영 배너 + Sync Lag 표시**

**인수기준**: 중앙 Control Plane·Registry·관제를 2시간 차단해도 작성·저장·결제확인·최종제출 SLO 유지.
(M2 Demo Gate 5번의 확장판 — 그쪽은 Convenience Plane 단절, 이쪽은 Control Plane까지 포함)

### T-M3-14 — Deadline Extension Workflow ⚠️ 권한 설계 주의

2026년 실제 장애에서 마감 연장 결정이 문제가 됐다. §01 B17의 핵심은 **기술팀이 마감연장을 결정하게 만들지 않는 것**이다.

- 워크플로는 시스템이 제공하되 **승인 권한은 입학처 정책담당**
- 연장 시 signed config version 생성 → 누가 언제 왜 연장했는지 불변 기록
- 개발자가 DB를 직접 고쳐 연장하는 경로를 만들지 않는다 (§01 B16)

## 종료 체크리스트 — v1.1 §01 E. 핵심 인수기준

- [ ] 중앙 2시간 단절: 원서손실 0, 핵심 SLO 유지
- [ ] 동일 Finalize 100회 재시도: Submission 1건
- [ ] PG Callback 30분 지연: 자동 정합화
- [ ] **단독 운영자 1명으로 마감시간 변경 불가**
- [ ] 특정 Application의 접수과정을 Evidence Package로 재구성 가능
- [ ] 운영계정으로 Audit 삭제 불가
- [ ] Production interactive write 경로 없음 (§01 B16)
- [ ] **노션 §01을 다시 읽고** C(필수 신규 기능) 8종이 전부 구현됐는지 대조
- [ ] 구현하며 바뀐 정책 구조를 노션에 반영
- [ ] 발견한 불일치를 D-N으로 등록·처리
