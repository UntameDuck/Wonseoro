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

## 진행 현황 (2026-09-26)

| 구분 | 태스크 |
|---|---|
| ✅ 완료 | T-M3-01 Deadline Policy · T-M3-02 Config Governance · T-M3-04 Reconciliation · T-M3-05 Exception Queue · T-M3-07 Evidence Package · T-M3-08 Circuit Breaker · **T-M3-15 서명된 활성화 기록** |
| 🟡 부분 | T-M3-03 hash-chain (물리 분리는 M5) · T-M3-06 Autonomous Mode (JWKS 캐시는 T-M5-02) · **T-M3-14 마감 연장** (화면은 Admin Web) |
| 🔜 다음 | T-M3-09 Purpose-scoped Token · T-M3-10 Retention · T-M3-11~13 Admin Web |

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

### Reconciliation Center — 4-way 대조 (T-M3-04·05)

불일치를 일부러 만들어 확인했다.

```
1. 결제 CONFIRMED + 접수 기록 없음  ← 돈은 나갔는데 접수가 안 된 상태
2. 대조 실행       → {"checked":1,"opened":1,"stillOpen":1}
3. Exception Queue → CRITICAL  PAYMENT_CONFIRMED_WITHOUT_SUBMISSION
                     facts: {amount, payment_id, verified_at}
4. 사유 없이 해소 시도 → 400
5. 늦게 접수 완료 (PG 콜백 지연 상황)
6. 대조 재실행     → {"autoResolved":1,"stillOpen":0}
7. 상태            → AUTO_RESOLVED / SELF_HEALED
```

검사 7종

| 종류 | 심각도 | 의미 |
|---|---|---|
| `PAYMENT_CONFIRMED_WITHOUT_SUBMISSION` | CRITICAL | 돈은 나갔는데 접수가 없다 |
| `SUBMISSION_WITHOUT_CONFIRMED_PAYMENT` | CRITICAL | 접수됐는데 확인된 결제가 없다 |
| `FINALIZED_WITHOUT_SUBMISSION` | CRITICAL | 같은 트랜잭션이라 정상적으로는 불가능. 나오면 DB 손상 |
| `SUBMISSION_WITHOUT_FINALIZED_STATUS` | CRITICAL | 상태와 접수 원장이 어긋났다 |
| `CENTRAL_ACK_MISSING` | HIGH | 통합 조회 반영만 늦다. **접수 실패가 아니다** |
| `OUTBOX_DEAD_LETTER` | HIGH | 재시도 한도를 넘겨 버려진 이벤트 |
| `PAYMENT_STATE_UNKNOWN_STALE` | HIGH | 확인 못 한 결제 방치. 두면 재결제 문의가 몰린다 |

원칙 두 가지를 코드에 박았다.

**정상 건은 큐에 올리지 않는다.** (§B18) 목록에 정상 건이 섞이면 실제 사고가 묻힌다.
**자동으로 고치지 않는다.** 돈과 접수 기회가 걸린 상태를 코드가 임의로 바꾸면 안 된다.
발견하고 사람에게 넘긴다. 다만 **저절로 풀린 건은 AUTO_RESOLVED 로 닫는다** —
해소된 건을 큐에 두는 것도 신호를 묻는 일이다.

수동 해소에는 처리 코드와 **사유가 필수**이고, before/after 가 감사에 남는다. (§B16)

### Evidence Package — §01 E "접수과정을 재구성 가능" 통과 (T-M3-07)

실제 접수 원서로 뽑은 결과.

```
evidenceHash : a3edfefe56d9aefd5191ff828af76301...
체인검증     : valid=true checked=6
접수번호     : 2027-UNIV-A-GLC4CZ25QS
요청 → 검증 → 확정 : 15:33:04.107 → 15:33:01.042 → 15:33:04.122
적용 정책    : env-7a01b0ee793a / 설정 cfg-2027-v1
clock offset : 0 ms
결제         : CONFIRMED 55,000원 (events=1)
동의         : PROFILE_SNAPSHOT

Timeline (6건, 전부 hash-chain 연결)
  15:31:26  APPLICATION_CREATED       ACCEPTED  fa9e9b83d2
  15:32:53  APPLICATION_SAVED         ACCEPTED  a5fd5bce4a
  15:33:01  PAYMENT_INTENT_CREATED    ACCEPTED  1325a7dd9a
  15:33:01  PAYMENT_VERIFIED          ACCEPTED  902b1d28b0
  15:33:04  APPLICATION_FINALIZED     ACCEPTED  126a8fddb0
  16:33:12  ADMIN_VIEWED_PII          ACCEPTED  c305d8440c  ← 열람 자체도 기록된다
```

담기지 않는 것: 이름·주민등록번호·연락처·주소·원서 본문·첨부파일 원본·PG 응답 원문.
**이것들 없이도 "언제 무엇을 했는가"는 증명된다.** 결제·서류·설정은 해시로만 동일성을 보인다.

조회에 **사유가 필수**다. 없으면 400이고, 열람 사실이 `ADMIN_VIEWED_PII` 로 남는다. (§8.3)
계약에는 사유 파라미터가 없어 추가했다. (D-24)

### ⚠️ 환경변수 대체 정책으로 접수하면 증적이 불완전해진다

위 결과의 `정책 스냅샷: 없음` 이 그 증거다.
이 원서는 `ALLOW_ENV_DEADLINE_POLICY=true` 였을 때 접수돼서 적용 정책이 `env-7a01b0ee793a` 다.
그 버전은 `deadline_policy` 테이블에 없으므로 **마감 판정의 근거를 되살릴 수 없다.**

분쟁이 나면 "어떤 마감정책으로 판정했는가"에 답하지 못한다.
`ALLOW_ENV_DEADLINE_POLICY` 를 운영에서 절대 true 로 두면 안 되는 이유이며,
D-1 이전 Config·정책 활성화가 인수 조건인 이유다. (§A14)

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

### 그래서 붙인 것 — Diff · Rollback · Freeze (T-M3-02 완료)

**Diff 를 확인해야 승인할 수 있다.**
승인 요청에 자기가 본 Diff 의 digest 를 함께 싣는다. 서버가 지금 계산한 값과
다르면 거부한다. 승인은 "이 설정 ID 에 동의한다" 가 아니라 **"이 변경에 동의한다"** 는
뜻이고, 본 뒤에 내용이나 기준이 바뀌면 같은 승인이 다른 의미가 되기 때문이다.

digest 에는 경로뿐 아니라 **값도 넣는다.** 경로만 넣으면 전형료가 60,000 에서
99,000 으로 바뀌어도 같은 digest 가 나와, 60,000 을 보고 한 승인이 99,000 을
통과시킨다.

위험도는 **방향**으로 나눈다. 더하는 변경은 대개 화면에 칸이 하나 느는 정도지만,
없애는 변경은 이미 작성 중인 입력을 무효로 만들고 검증을 통과시켜 버린다.

| 변경 | 위험도 |
|---|---|
| 전형 양식·전형료·모집단위 삭제 | DESTRUCTIVE |
| 전형료 값 변경 | DESTRUCTIVE — 이미 결제한 사람과 앞으로 결제할 사람이 다른 금액을 낸다 |
| 길이·범위 상한을 줄이거나 하한을 올림 | DESTRUCTIVE — 이미 통과한 입력이 오류가 된다 |
| `type`·`pattern`·`enum` 변경 | DESTRUCTIVE |
| 필수 항목 추가 | WARN — 이미 작성한 지원자가 다시 입력해야 한다 |
| 항목·전형 추가 | INFO — §A5 가 바라는 변경이다 |

**되돌리기는 새 버전을 만들지 않는다.**
전에 ACTIVE 였던 **그 행**을 다시 올린다. 그 행에는 서로 다른 두 명의 실제 승인이
이미 기록돼 있다. 새로 만들면 승인자를 지어내야 하고, 그건 D-21 로 막은 것을
코드로 우회하는 일이다. 그래서 되돌릴 수 있는 대상은 **한 번이라도 실제로 적용된
적이 있는 설정**뿐이다 — 활성화된 적 없는 초안으로 가는 것은 되돌리기가 아니라
새 변경이다. 사유는 필수다.

**Freeze 는 변경을 막고 복구는 막지 않는다.**
마감 24시간 전부터(`CONFIG_FREEZE_HOURS`) 설정 활성화를 막는다. 마지막 몇 시간에
지원자가 몰리고, 그때의 변경은 검증할 시간이 없다. 다만 **되돌리기에는 걸지 않는다** —
Freeze 는 새 변경을 멈추는 장치이지 복구를 멈추는 장치가 아니고, 잘못된 설정으로
마감을 맞는 쪽이 훨씬 큰 사고다.

마감 **연장**은 이 잠금과 무관하다. 연장은 `deadline_policy` 의 일이고
`config_version` 을 건드리지 않는다. (§B17)

```
초안 생성                          201
Diff 조회                          200  변경 2건 / 파괴적 0건
Diff 확인 없이 승인                400
Diff 확인 후 1차 승인              200  남은 승인 1
2차 승인                           200  남은 승인 0
활성화                             200  ACTIVE
빈 설정 Diff                       파괴적 2건 (forms.EARLY · fees.EARLY 삭제)
다른 Diff 를 본 채 승인            409
적용된 적 없는 설정으로 되돌리기    400
잘못된 운영 토큰                   403
마감 임박 시 새 설정 활성화        403
마감 임박 시 되돌리기              허용
```

**D-21 이 가장 중요하다.** §A14 가 2인 승인을 요구하는 마감시각·전형료·모집단위·
지원자격·PG 설정이 전부 `config_json` 에 들어가는데, DB 가 그것을 지키지 않는다.
코드는 우회 가능하고 DB 는 아니다.

### Dependency Circuit Breaker — 끊긴 뒤의 규칙이 의존성마다 다르다 (T-M3-08)

§01 C8 은 "외부 장애의 전파 차단" 한 줄이다. 끊는 장치는 하나로 만들 수 있지만,
**끊긴 뒤 무엇을 하는지는 의존성마다 정반대다.** 그래서 규칙을 따로 정했다. (D-32)

| 의존성 | 끊기면 | 이유 |
|---|---|---|
| 중앙 Profile Vault | 빈 Snapshot 으로 원서 생성 계속 | 중앙은 편의 계층이다 (D-18). Breaker 는 **타임아웃 대기만** 없앤다 |
| PG 결제 확인 | CREATED·PENDING → **UNKNOWN**, Reconciliation 으로 | fail-open 하면 돈을 안 받고 접수시킨다. FAILED 로 떨어뜨리면 재결제로 중복 결제가 된다 |
| PG 결제 의도 생성 | 503 | 결제창이 열리기 전이다. 돈도 기록도 없다 |
| 중앙 Sync Gateway | 행을 집지 않음, **재시도 횟수를 쓰지 않음** | 중앙 장애는 이벤트의 잘못이 아니다 (D-33) |
| 접수 API (AV 보고) | 검사하지 않음 | 보고 못 할 판정에 CPU 를 쓰지 않는다 |

공통: 연속 5회 실패로 열고 30초 뒤 **탐침 1건**. 4xx 는 세지 않는다 — 상대가 살아서 거절한 것이다.
상태는 Pod 안에만 둔다. 공유 저장소에 두면 그게 새 의존성이 된다.

**readiness 에 넣지 않는다.** 중앙이 죽었다고 `readyz` 가 실패하면 모든 Pod 가 트래픽에서 빠져
접수 전체가 멈춘다. 끊는 이유가 그걸 막는 것이다. 상태는 `GET /healthz/dependencies` 로 본다.

**구현 중 발견한 것 — 중앙이 2분 반만 죽어도 이벤트가 버려졌다.** (D-33)
relay 는 실패마다 재시도 횟수를 올려 10회에 DEAD 로 보냈고, Backoff 누적이 약 142초였다.
재시도 횟수가 "이 이벤트가 문제인가" 와 "중앙이 살아 있는가" 를 섞어 세고 있었다.

가짜 중앙을 끄고 켜며 확인한 결과 (`relay.integration.test.ts`)

```
중앙 503        relay: sent=0 failed=1 dead=0 held=4 circuit=OPEN   ← 2번째 실패에서 열림
열린 동안       행을 집지 않음, 중앙 요청 0
탐침 ×3         held=1 circuit=OPEN (매번 1건만, attempt_count 증가 없음)
중앙 복구       HALF_OPEN -> CLOSED  sent=1 → sent=4
결과            5건 전부 SENT, DEAD 0
```

PG 쪽은 `payment-circuit.integration.test.ts` — 끊기면 UNKNOWN 과 원인(`ECONNREFUSED`/`CIRCUIT_OPEN`)이
`payment_event` 와 감사에 남고, 열린 뒤에는 PG 호출 0, 복구되면 같은 결제가 CONFIRMED 로 확정된다.

### Autonomous Mode — 무엇을 지금 하고 무엇을 미뤘나 (T-M3-06 🟡)

Demo Gate 5 에서 **중앙을 내린 채 생성→저장→결제→제출이 이미 통과**했다. 접수 경로는 원래
중앙을 거치지 않는다. 그래서 이 태스크에서 남은 것은 두 종류였다.

| 항목 | 결정 | 이유 |
|---|---|---|
| Central Dependency Health Gate | ✅ 이번에 | 인증과 무관 |
| Autonomous 운영 배너 · Sync Lag 표시 | ✅ 이번에 | 화면 어디에도 없었다 |
| Offline Event Spool | ✅ T-M3-08 | 중앙 장애 중 Outbox 가 DEAD 로 떨어지지 않음 (D-33). 적체 경보 추가 |
| Local JWKS Cache | ⏭ T-M5-02 | 검증할 토큰이 아직 없다 (`AUTH_MODE=dev-headers`) |
| 서명된 Local Policy Snapshot | ✅ T-M3-15 | 공개키 + 서명된 활성화 기록으로 대학 밖에서 검증 |

**판단이 바꾸는 것은 안내뿐이다.** AUTONOMOUS 라고 막히는 기능은 없다. 필요한 이유는 사람 쪽이다 —
지원자는 "내 원서" 에 접수가 안 보이면 접수가 안 된 줄 알고 **다시 결제하거나 처음부터 다시 한다.**
그래서 배너 문구의 순서를 정했다. ① 무엇이 정상인지 ② 접수 완료를 무엇으로 확인하는지(접수번호)
③ 무엇이 늦는지. 경고가 아니라 안내 톤이다.

설계 결정

- **화면 조회는 메모리만 읽는다.** Gate 가 10초마다 중앙과 Outbox 를 확인해 두고,
  `GET /api/v1/meta/operating-mode` 는 그 결과만 돌려준다. 마감 피크에 수천 명이 30초마다 물어도
  DB·중앙 부하는 늘지 않는다
- **한 번 실패로 넘어가지 않는다.** 확인 5회 연속 실패로 회로가 열려야 AUTONOMOUS. 순간 장애에
  배너가 깜빡이면 지원자는 그때마다 불안해진다
- **첫 확인 전에는 연결됐다고 말하지 않는다.** 모르는 것을 정상으로 표시하지 않는다
- **적체는 relay 에 묻지 않고 DB 를 직접 센다.** relay 가 죽으면 relay 에 물은 적체도 함께 안 보인다
- **공개 조회에 운영 정보를 싣지 않는다.** DEAD 건수·회로 상태·실패 원인은 `/healthz/dependencies` 에만

실제로 끄고 켜며 확인한 결과

```
중앙 없이 기동          AUTONOMOUS  (배너: 시각 표시 없음 — 끊긴 적이 아니라 연결된 적이 없다)
중앙 기동 후 약 18초    CONNECTED   로그: CONNECTED 복귀 — 자율 운영 71s, 미전송 0건
                                    배너 사라짐
중앙 정지 후 약 46초    AUTONOMOUS  로그: AUTONOMOUS (CENTRAL_UNREACHABLE) — 접수는 계속된다
                                    배너: "… (17:18부터)"
```

첫 구현은 **기동할 때부터 중앙이 없으면 경보를 한 번도 내지 않았다.** 초기 상태가 이미 AUTONOMOUS 라
"전환" 이 일어나지 않았기 때문이다. 운영자가 가장 알아야 할 경우라, 전환이 아니라 **확정 시점에
한 번** 내도록 고쳤다.

### 마감 연장과 서명된 활성화 기록 (T-M3-14 🟡 · T-M3-15 ✅)

§B17 의 핵심은 **기술팀이 마감 연장을 결정하게 만들지 않는 것**이다. 시스템은 결정하지 않고,
입학처의 결정을 기록하고 집행한다.

**연장 워크플로** (`POST /admin/v1/deadline-policies/extensions`)

| 규칙 | 이유 |
|---|---|
| 사유 + **입학처 결정 문서번호** 필수 | 결정 근거 없는 연장은 기술팀이 마감을 바꾼 것과 구별되지 않는다. DB CHECK 도 막는다 |
| 지금 적용 중인 정책을 기준으로만, 방식(mode)은 물려받음 | 연장 절차로 판정 기준까지 바꾸면 승인자는 "늦춰진다" 고만 알고 승인한다 |
| 마감을 늦추는 것만 | 앞당기는 것은 연장이 아니다 |
| 작성자가 아닌 2인 승인 | 일반 정책과 같다 |
| Freeze(마감 24시간 전 잠금)에 걸리지 않음 | 장애로 연장해야 하는 순간이 바로 마감 직전이다 |
| **승인하는 사이 기준이 바뀌면 409** | 두 연장이 같은 기준을 딛고 올라가면 둘 다 "현재를 연장한다" 고 믿은 채 적용된다 |

활성화 쪽에 두 가지를 더 막았다.

- **한 번 적용된 정책은 다시 적용하지 않는다.** 전에는 됐다 — 옛 정책을 다시 올리면
  옛 마감으로 돌아간다. 사실상 승인 없는 단축이다
- **적용 시각에 이미 지난 마감은 적용하지 않는다.** 적용 즉시 접수가 닫히는 소급 마감이다

**서명된 활성화 기록** (`activation_record`, 0003)

정책·설정 행은 "무엇" 이고, 이 기록은 "언제·누가·왜 적용했는가" 다. 적용 사건마다 한 행.
되돌리기(rollback)는 같은 행의 `activated_at` 을 덮어쓰므로, 이 기록이 없으면 두 번째 적용이
첫 번째 적용의 흔적을 지운다. 되돌리기 사유도 전에는 **로그에만** 있었다.

- Ed25519 서명. **공개키를 공개한다** — HMAC 이면 검증하는 쪽이 위조도 할 수 있다
- 활성화와 **같은 트랜잭션**에서 기록한다. 적용됐는데 기록이 없으면 소문이 된다
- **추가만 가능** — UPDATE·DELETE·TRUNCATE 를 트리거가 막는다. 서명은 지워진 것을 잡지 못한다
- 조회할 때마다 서명을 다시 검증하고, 컬럼이 서명한 내용과 같은지도 본다
- Evidence Package 가 "적용된 마감이 서명된 기록과 일치하는가" 를 함께 보여준다

**발견한 것 셋**

1. **운영자 행위는 감사 체인이 아니었다.** (D-36) 원서 없는 감사 이벤트는 매번 GENESIS 에서
   시작했다 — 하나를 지워도 드러나지 않았다. `ADMIN_CHANGED_CONFIG` 는 정의만 있고 쓰이지
   않았다. 시스템 체인 하나로 잇고, 동시 기록은 잠금으로 줄 세웠다
2. **깨진 한글이 성공 응답과 함께 저장됐다.** (D-37) Windows 셸에서 CP949 로 보낸 결정번호가
   `����ó-2026-117` 로 서명된 기록에 영구히 남았다. 기본 JSON 파서가 잘못된 UTF-8 을 U+FFFD 로
   바꿔 받아들였기 때문이다. 이제 400 으로 거절한다. 지원자 이름·자기소개도 같은 경로였다
3. **지원자 화면이 원서 생성 직후 멈춰 있었다.** 9/23 소유권 검사(D-28) 이후 화면의 조회 호출
   4종이 신원을 싣지 않아 403 이었다. 서버 테스트는 서비스를 직접 불러 이 경로를 지나지 않았다

실제 HTTP 로 돌린 결과

```
기준 정책 초안 → 2인 승인 → 적용          201 / 200 200 / 200
연장 — 결정번호 없음                      400
연장 — 마감을 앞당김                      400
연장 초안                                 201  e2e-v1-ext1 ← e2e-v1
  작성자 본인 승인                        403
  1명 승인 후 적용                        403
  2번째 승인 → 적용 (마감 1시간 전)       200 → 200
  같은 정책 재적용                        400
지원자가 보는 마감                        e2e-v1-ext1
적용 이력   ACTIVATE e2e-v1 by officer2 서명 VALID
            EXTEND   e2e-v1-ext1 by officer3 결정 입학처-… 서명 VALID
            allSignaturesValid true | systemChain valid
```

⚠️ **누가 했는지는 아직 약하다.** 운영 API 는 공유 토큰 뒤에 있고 `x-admin-id` 는 기록일 뿐
신원 증명이 아니다. 다만 서로 다른 두 승인자와 적용자가 서명된 기록에 함께 묶이므로
"한 사람이 혼자 바꿨다" 는 구별된다. 역할(입학처 정책담당) 강제는 T-M5-10 에서 붙인다.

## 태스크

| ID | 태스크 | 담당 | 근거 노션 | 인수기준 | 상태 |
|---|---|---|---|---|---|
| T-M3-01 | **Deadline Policy Engine** | 송리안 | §01 A2·C1 | 3개 룰 프로파일, 2인 승인, 정책버전, 경계값 검증 | ✅ |
| T-M3-02 | **Configuration Governance** | 송리안 | §01 A14·C5 | 2인 승인·예약 활성화·Diff 확인 승인·Rollback·Freeze | ✅ |
| T-M3-03 | Audit hash-chain + 분리 저장소 | 송리안 | §01 A11, v1.0 §9 | hash-chain·변조 검출 ✅ / WORM 물리 분리는 M5 | 🟡 |
| T-M3-04 | **Reconciliation Center (4-way)** | 송리안 | §01 A4·B18·C2 | Application/Payment/Submission/Central 대조 | ✅ |
| T-M3-05 | Exception Queue + 수동 승인 복구 | 송리안 | §01 A4·B16 | 불일치만 큐로, 보정은 Admin Action API로만 | ✅ |
| T-M3-06 | **Autonomous Mode** | 송리안 | §01 A1·C3 | Local Policy Snapshot·JWKS Cache·Offline Spool | 🟡 |
| T-M3-07 | **Evidence Package 생성** | 송리안 | §01 A11·C6 | 상태 Timeline·정책·결제증적·config·clock·hash 검증 | ✅ |
| T-M3-08 | **Dependency Circuit Breaker** | 송리안 | §01 C8 | PG/중앙/문자/메일 장애 전파 차단 (문자·메일은 붙일 때) | ✅ |
| T-M3-09 | Purpose-scoped Token | 송리안 | §01 A12 | 중앙 토큰으로 원본 재식별 불가, key rotation |
| T-M3-10 | Retention Matrix + Policy Validation | 송리안 | §01 A15 | 법정·기관 기준보다 짧게 설정 불가 |
| T-M3-11 | Admin Web — Config 승인 화면 | 권민준 | §01 A14 | 단독 승인 불가가 UI에서 강제됨 |
| T-M3-12 | Admin Web — Reconciliation 콘솔 | 권민준 | §01 C2 | 불일치 목록·사유 입력·before/after |
| T-M3-13 | Admin Web — Evidence 조회 | 권민준 | §01 C6 | 특정 원서의 접수과정 재구성 |
| T-M3-14 | Deadline Extension Workflow | 공동 | §01 B17 | **권한은 입학처 정책담당.** 기술팀이 결정하지 않는다 | 🟡 백엔드 |
| T-M3-15 | 마감연장 시 signed config version 생성 | 송리안 | §01 B17 | 연장 이력이 불변 기록으로 남음 | ✅ |

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
