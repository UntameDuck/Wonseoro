# M3 종료 · M4 착수 준비

> 작성: 2026-09-26 · 갱신: 2026-09-27 (G1 · G2 완료 · 노션 본문 1차 반영 · 결정 8건 확정 · 저장소 OpenAPI v1.2.0)
> **M4 는 검증 단계지 설계 단계가 아니다.** 여기서 구조 결함이 나오면 M1 까지 되돌아간다.
> 그래서 M3 를 닫기 전에, 체크리스트를 "문서상 완료" 가 아니라 **코드로 확인한 상태**로 채운다.
>
> 이 문서는 네 가지를 한곳에 모은다.
> ① M3 종료 체크리스트의 실제 상태 ② 닫기 전에 구현해야 하는 것 ③ 사람이 내려야 할 결정
> ④ M4 를 시작하는 데 필요한 것(첨부·도구·환경)

---

## ① M3 종료 체크리스트 — 실제 상태

§01 E 인수기준과 M3 종료 조건을 하나씩 코드·DB 로 확인했다.

| 항목 | 상태 | 근거 |
|---|---|---|
| 중앙 2시간 단절: 원서손실 0, 핵심 SLO 유지 | 🟡 기능 ✅ · 시간 시험 M4 | Demo Gate 5(중앙 정지 중 생성→제출), relay 통합 테스트(DEAD 0). **2시간을 버티는지는 T-M4-35** |
| 동일 Finalize 100회 재시도: Submission 1건 | ✅ | M2 Demo Gate 4. DB `submission.application_id` UNIQUE 가 최종 방어 (`db:verify` 1번) |
| **PG Callback 30분 지연: 자동 정합화** | ✅ 기능 · 시간 시험 M4 | 아래 ② G1 — 콜백·재확인 워커·대조 스케줄. **실제 30분 지연은 T-M4-34** |
| 단독 운영자 1명으로 마감시간 변경 불가 | ✅ | API·DB CHECK·관리자 콘솔 화면 (M3 문서) |
| Evidence Package 로 재구성 | ✅ | 콘솔 증적 조회 |
| **운영계정으로 Audit 삭제 불가** | ✅ DB 안 · WORM M5 | 아래 ② G2 — 앱 역할은 권한 없음, 소유자·슈퍼유저 평소 경로는 트리거가 막음 (`db:verify` 15~18) |
| Production interactive write 경로 없음 (§B16) | 🟡 | 앱 쓰기 경로는 승인된 Admin API 뿐, 앱은 최소권한 역할로 붙는다 (G2). **슈퍼유저 break-glass 는 남는다** — 접근 통제·기록은 M5 (Vault 동적 자격증명) |
| 노션 §01 C 8종 대조 | ✅ 대조 완료 | 아래 표 |
| 바뀐 정책 구조를 노션에 반영 | 🔧 **본문 1차 완료** (§01·§06·§09·v1.0 ✅, §02·§03 본문 ✅) — 32개 수정 지점 남음 (첨부 교체·결정 대기) | ③ · 부록 |
| 발견한 불일치를 D-N 으로 등록 | ✅ | D-1 ~ D-41 |

### §01 C 필수 신규 기능 8종 대조

| # | 기능 | 상태 |
|---|---|---|
| C1 | Deadline Policy Engine | ✅ T-M3-01 · 연장 T-M3-14 |
| C2 | Reconciliation Center | ✅ 대조·예외 큐 + **1시간 자동 실행** (G1, 2026-09-27) |
| C3 | Autonomous Mode | ✅ T-M3-06 — JWKS 캐시는 T-M5-02 단계 7 로 마무리(2026-10-03, D-67) |
| C4 | Admission Peak Mode | ⏭ **T-M4-07** 로 이미 잡혀 있다 |
| C5 | Configuration Governance | ✅ T-M3-02 · 서명 T-M3-15 |
| C6 | Evidence Package | ✅ T-M3-07 · 콘솔 |
| C7 | Support Self-check | ✅ M2 (D-16) |
| C8 | Dependency Circuit Breaker | ✅ T-M3-08 |

---

## ② M3 를 닫기 전에 구현해야 하는 것

### G1. 결제 자동 정합화가 없다 (D-40) — ✅ **완료 (2026-09-27)**

코드를 따라가 보니 §A4 "Callback + Provider Polling 이중 확인" 의 두 쪽이 모두 비어 있다.

- PG **콜백을 받는 엔드포인트가 없다**
- PENDING·UNKNOWN 결제를 **다시 확인하는 주기 작업이 없다** — 지원자 화면이 `verify` 를 불러야만 확인된다
- 대조(Reconciliation)는 **사람이 버튼을 눌러야** 돈다. §B18 의 "D+1 자동 대조" 스케줄이 없다

그래서 지원자가 결제 직후 창을 닫으면, 그 결제는 **누군가 다시 확인할 때까지** PENDING 으로 남는다.
돈은 나갔는데 접수는 멈춘 상태가 저절로 풀리지 않는다 — 이 제품이 가장 두려워하는 상태다.

해야 할 것
1. **결제 확인 워커** — PENDING·UNKNOWN 을 Backoff 로 다시 묻는다(PG Breaker 를 탄다). CONFIRMED 가 되면
   원서가 이미 제출 요청 상태였는지 보고 **자동 Finalize 는 하지 않는다** — 제출은 지원자의 의사 표시다.
   지원자에게는 Self-check·화면이 "결제 확인됨, 최종제출을 눌러 주십시오" 로 알린다 (§B4 재결제 유도 금지 유지)
2. **PG 콜백 엔드포인트** — 서명 검증(Mock 은 HMAC), 멱등(같은 콜백 여러 번), **콜백 값을 믿지 않고 PG 에 재조회**
3. **대조 스케줄** — 1시간마다 최근 48시간, 매일 새벽 D+1 전체. 여러 Pod 가 동시에 돌지 않게 advisory lock
4. 시험 — Mock PG `SLOW`·`UNKNOWN`·`DOWN` 에서 콜백 1~30분 지연을 시계로 당겨 재현 (T-M4-34 의 기능 부분)

**G1 완료 (2026-09-27)**

| 부분 | 내용 |
|---|---|
| 설정 | `PG_CALLBACK_SECRET`(운영 필수) · `PAYMENT_RECHECK_*`(30초 간격, 50건, 48시간) · `RECON_SCHEDULE_*`(1시간, 최근 48시간) |
| 원문 바이트 보존 | JSON 파서가 `req.rawBody` 를 남긴다 — 서명은 받은 바이트 그대로 검증. 공백만 바꾼 본문은 403 (실측) |
| 콜백 엔드포인트 | `POST /api/v1/payments/callbacks/:provider` · `@ExternalCallback()` 로 Idempotency-Key 강제 제외(다른 경로는 그대로 400) · 서명 불일치 403 · 모르는 거래·중복도 200 |
| 콜백 처리 | `payment_event(payment_id, provider_event_id)` 유니크로 한 번만 → **PG 재조회로 상태 결정** (본문이 FAILED 라 해도 PG 가 CONFIRMED 면 CONFIRMED, 반대도) → **자동 Finalize 없음** |
| 결제 재확인 워커 | PENDING·UNKNOWN 만 · 결제별 Backoff 30초×2^(n−1) 최대 30분 · 48시간 지나면 대조로 넘김 · PG 회로가 열리면 주기 건너뜀 |
| 대조 스케줄 | 1시간마다 `reconcile(48h)` |
| 한 Pod 만 | 워커·스케줄 모두 `withLeaderLock` — ~~세션 advisory lock~~ → **잠금 전용 연결의 트랜잭션 잠금**(2026-09-30, D-54). 세션 잠금은 PgBouncer transaction 풀에서 새어 워커가 주기를 건너뛰었다. PG 호출은 다른 연결로 하므로 잠금 트랜잭션은 행을 잠그지 않는다 (§B3) |
| 시험 | 13건 (`payment-reconcile.integration.test.ts`) — 서명·다른 PG·재조회·중복·미제출·모르는 거래·상태 필터·Backoff·기한·회로·잠금·실제 PG 로 확인 끝·스케줄 잠금 |

남은 것은 **시간 시험**뿐이다 — 콜백 1~30분 지연을 실제 시계로 (T-M4-34).

### G2. 운영계정으로 감사 기록을 지울 수 있다 (D-41) — ✅ **완료 (2026-09-27)**

- `audit_event` 에 **추가 전용 보호가 없다** (활성화 기록에는 붙였다 — 0003)
- 애플리케이션이 **슈퍼유저 역할 하나(`wonseoro`)** 로 DB 에 붙는다. 앱이든 운영자든 같은 권한으로 지울 수 있다

해야 할 것
1. **역할 분리** — `kadmission_app`(업무 테이블 읽기·쓰기, `audit_event`·`activation_record` 는 **INSERT·SELECT 만**),
   `kadmission_migrator`(DDL), `kadmission_auditor`(읽기 전용). 앱은 `kadmission_app` 으로 붙는다
2. `audit_event` 에도 UPDATE·DELETE·TRUNCATE 차단 트리거 (역할을 우회한 슈퍼유저 psql 까지)
3. **테스트 정리 방식 변경** — 지금 통합 테스트 4개 파일이 `DELETE FROM audit_event` 로 정리한다. 이게 된다는 것
   자체가 이 결함의 증거다. 테스트는 원서를 지우지 않고 남기거나(보관된 모집처럼) 전용 테스트 DB 를 쓴다
4. `db:verify` 에 "앱 역할로 감사 삭제 시도 → 거부" 추가

물리 분리(WORM · Object Lock)는 M5 다. G2 는 **같은 DB 안에서도 지울 수 없게** 하는 것까지다.

**G2 완료 (2026-09-27)**

| 부분 | 내용 |
|---|---|
| 역할 (`0004`) | `kadmission_app` — 업무 테이블 SELECT·INSERT·UPDATE·DELETE, **감사·적용 기록은 SELECT·INSERT 만**, TRUNCATE·DDL 없음 · `kadmission_migrator` — 스키마·테이블 소유자 · `kadmission_auditor` — 읽기만. 모두 NOLOGIN, 개발 로그인은 `infra/db/dev-roles.sql` |
| 소유권 | 테이블 소유자를 migrator 로 옮겼다 — 소유자는 GRANT 와 관계없이 뭐든 할 수 있어서, 앱이 소유자면 권한 분리가 의미 없다 |
| 트리거 | `audit_event` UPDATE·DELETE(행) · TRUNCATE(문장) 차단 — 계정과 관계없이 선다 |
| 서비스 | admission-api · document-service · event-relay `.env.example` 을 앱 역할로 |
| 시험 | **앱 역할로 돈다** — 권한을 빠뜨린 테이블이 있으면 시험이 깨진다. 감사 기록 정리와 변조 재현만 `test-support/break-glass.ts` (슈퍼유저 `DATABASE_ADMIN_URL` + 트리거를 일부러 끔). 활성화 기록 시험은 두 겹(앱 권한 거부 · 소유자 트리거 거부)을 따로 확인 |
| `db:verify` | 15 앱 역할 수정·삭제·비우기 거부 · 16 DDL 거부 · 17 테이블마다 권한이 규칙대로(새 테이블 권한 누락·추가 전용 테이블에 UPDATE 부여를 잡는다) · 18 소유자도 트리거에 막힘 · 감사 역할은 읽기만 |

**DB 안에서 막을 수 없는 것** — 슈퍼유저가 `session_replication_role=replica` 로 트리거를 끄는 것. 시험 정리가 바로 이 경로를
쓴다는 것이 그 증거다. hash-chain 은 이렇게 고친 것을 **찾아내고**(시험 2건), 막는 것은 WORM(M5)이다.

---

## ③ 사람이 내려야 할 결정

코드가 대신 정할 수 없는 것들이다. 정해지지 않으면 해당 부분은 지금 상태로 남는다.

| # | 결정 | 왜 필요한가 | 지금 상태 |
|---|---|---|---|
| 1 | **D-27** 중앙에 가명 지원자 참조를 둘 것인가 | §A3 "최소 정보" 와 충돌할 수 있다 | ✅ **둔다** (2026-09-27) — 목적 키 HMAC (D-39) |
| 2 | **D-29** 원서 자연키 제약을 부분 유니크로 약화 | canonical DDL 제약을 **약화**하는 변경 | ✅ **채택 + 키에서 모집단위 제외** (2026-09-27) — 한 전형 한 모집단위(대학입학전형기본사항). 0005 |
| 3 | **D-7** 접수 **후** 취소를 어떻게 다룰지 | 원장을 고칠 수 없다. 별도 레코드가 필요한지 | ✅ **레코드 없음, 409 유지** (2026-09-27) — 접수된 원서 취소 원칙적 불가. 전형료 반환은 결제 쪽 |
| 4 | **D-38** 보존기간 하한값 | 법정·기관 하한은 개인정보 담당이 정한다 | ✅ **접수 원서 10년** (2026-09-27) — 국가기록원 가이드 입시관리업무. 서류·신원 항목 분리 후속 |
| 5 | **D-30** `system_config` 가 ERD 에만 있고 DDL 에 없음 | 둘 중 하나를 맞춰야 한다 | ✅ **ERD 에서 뺀다** (2026-09-27) |
| 6 | **M4 실행 환경** | 수치 인수기준(3,000 CCU · 1,000 RPS · 2시간 단절)은 이 개발 PC 로 못 낸다 (Docker 8GB) | 아래 ④ |
| 7 | **노션 수정 권한** | 수정 지점(처음 55개)을 누가 반영하나 | ✅ **정함 (2026-09-27)** — 결정이 필요 없는 항목만 반영, **페이지마다 확인받고** 쓴다. 1~5 번 결정 항목은 결정 뒤에 |

---

## ④ M4 를 시작하는 데 필요한 것

### 첨부 3종 — **없으면 M4 를 시작할 수 없다**

노션 §05·§08 본문에는 레플리카·리소스·HPA 숫자가 **없다.** 전부 첨부 안에 있다. (D-5 잔여)

| 첨부 | 노션 | attachment id | block id |
|---|---|---|---|
| `k-admission-k6.js.txt` | §08 | `846bc806-699f-4852-b6c0-fcaeb7dee39f` | `4df25cda-c2c6-4593-8657-13ba7bb4adb6` |
| `k-admission-values-m.yaml` | §05 | `96ef60d0-5d8a-4a09-8ded-5ab794a3da73` | `a4fa4603-b518-4b73-b8c7-577f4668c4dd` |
| `k-admission-runtime.yaml` | §05 | `4cd23155-7587-47f4-80b3-fc2568d8fd7c` | `1d2ae3da-8232-4800-a382-58c820d26be3` |

spaceId `78f75ab5-debe-81f4-9e86-00033cef683d`. Notion MCP 로는 받을 수 없다(`object_not_found`, D-5).
**노션에 로그인된 브라우저**에서 D-5 의 서명 URL 절차로 받고, 문자수·줄수·체크섬을 기록한다.

✅ **방법 정함 (2026-09-27)** — 사용자의 Chrome 노션 로그인 세션으로 받는다. M4 착수 시점에 진행.

### 도구

| 도구 | 상태 | 용도 |
|---|---|---|
| Docker | ✅ 29.2 (VM 8GB · 18 CPU) | kind 노드 |
| kubectl | ✅ 1.34 | |
| **kind** | ❌ 없음 | 대학별 로컬 클러스터 (T-M4-04) |
| **helm** | ❌ 없음 | 차트 (T-M4-01) |
| **k6** | ❌ 없음 | 부하 시험 (T-M4-30~) |

설치 (Windows, 사용자가 실행):

```bash
winget install -e --id Kubernetes.kind
```

```bash
winget install -e --id Helm.Helm
```

```bash
winget install -e --id GrafanaLabs.k6
```

### 환경 — 로컬로 할 수 있는 것과 없는 것

이 PC(여유 RAM 2~3GB, Docker VM 8GB)로는 kind 클러스터 3개 + DB + 3,000 VU 를 동시에 못 올린다.

| 로컬(kind)로 증명 가능 | 실제 K-PaaS 가 필요 |
|---|---|
| Helm 차트·Runtime 보안 기준 적용 (T-M4-01~03) | 3,000 CCU + 1,000 RPS Burst (T-M4-32) |
| **대학 간 장애 격리** — 클러스터 2개로 축소 (T-M4-42) | 6시간 Soak (T-M4-41) |
| Finalize 100회 동시 · PG 지연 · API Node 강제 종료 | DB Primary Failover 실측 (T-M4-36) |
| 중앙 단절 (시간을 줄여서) | Size Profile 실측 보정 |

**제안** — 로컬에서 격리·기능 시험을 먼저 끝내 구조 결함을 잡고, 수치 시험은 K-PaaS 환경이 확보되는 대로.
수치를 로컬에서 낸 척하지 않는다 — 로컬 결과는 "축소 환경" 으로 명시한다.

---

## 확정한 순서 (2026-09-27)

G1 → G2 순서로 구현한다 (사용자 결정). 현재 위치는 ◀ 표시.

```
1. G1 결제 자동 정합화 (D-40)          ✅ 2026-09-27
2. G2 감사 삭제 불가 · DB 역할 분리 (D-41)   ✅ 2026-09-27
3. 노션 반영 (결정 불필요 항목, 페이지별 확인)   ✅ 본문 1차 2026-09-27
4. 결정 8건   ✅ 2026-09-27 · 저장소 OpenAPI v1.2.0 ✅
   → D-23 마이그레이션 → 병합 DDL → 첨부 교체(§02 DDL · §03 yaml) → M3 종료 선언   ✅ 2026-09-27
5. 첨부 배치 ✅ 2026-09-27 (7종, D-5 종결) · 도구 설치 ✅ (kind 0.33 · Helm 4.3 · k6 2.2)
6. M4 — Helm 차트 ✅ → kind 2클러스터 ✅ → 대학 간 격리 시험(T-M4-42) ✅ 2026-09-28 → 기능 시험 ◀ 현재 → (K-PaaS) 수치 시험
```

---

## 부록 — 노션 반영 목록 (자동 생성)

불일치 대장의 "노션 반영 ⬜" 을 노션 문서별로 묶었다. 대장이 원본이고, 이 목록은 `python scripts/notion-changeset.py --write` 로 다시 만든다. 반영한 조각은 대장에 `✅` 로 남기면 여기서 빠진다.

| 노션 문서 | 반영 |
|---|---|
| §01 운영 리스크 | ✅ 2026-09-27 — D-31·32·33·34·35·39·40 9곳 |
| §02 ERD·DDL | 🟡 2026-09-27 — 본문 "v1.1 구현 반영" 절 + ERD 2줄 (D-21·25·35·38·41). **첨부 DDL 교체는 D-29 확정 뒤 한 번에** |
| §03 OpenAPI | 🟡 2026-09-27 — 본문 경로 목록 17개 추가 · 공통 요구 3줄 (D-7·16·19·20·22·24·26·28·34·35·37·39·40, T-M3-02). **첨부 yaml 은 아직** — 저장소 `packages/contracts/openapi/k-admission.v1.yaml` 을 먼저 맞추고 올린다 |
| §06 보안정책 | ✅ 2026-09-27 — DB 역할 절 (D-41) · 입력 검증 (D-37) |
| §09 STRIDE | ✅ 2026-09-27 — Information Disclosure 에 BOLA (D-28) |
| §04 CloudEvents | ⏸ 남은 것이 D-27 결정(`subjectRef`)과 새 첨부(중앙 DDL, D-14)뿐 |
| v1.0 본문 | ✅ 2026-09-27 — §4 Backend(D-3) · §5.6 접수 전 취소(D-7) · §6.2 이벤트 예시(D-1·4·15) · §9 감사(D-7·36) · §12 6단계(D-2) · §17.1 접수번호(D-15) |
| v1.1 §10 트래픽 | ⬜ D-18 (부록에서는 v1.0 으로 분류된다 — "§10 §1" 표기 때문) |

<!-- 자동 생성: 불일치 대장의 "노션 반영 ⬜" 항목 16건에서 23개 수정 지점 -->

### 먼저 결정·확인이 필요한 것 — 2건

- **D-58** 🟡 어댑터 구현 — 실 clamd 연동 확인 대기(T-M5-08)  
  <sub>서류 검사 엔진이 파일을 읽지 않는 흉내뿐이었고, 검사 기록은 늘 'mock-av' 였다</sub>
- **D-60** 🟡 저장소 반영·kind 확인 — 노션 반영 대기  
  <sub>§04 심장박동(sync.heartbeat)을 아무도 보내지 않아 중앙이 조용한 대학과 죽은 대학을 구별하지 못했다 🔴</sub>

### §01 운영 리스크 — 2건

- **D-56** §A5 Config Linter 규칙 — [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>화면이 전형 설정을 다 읽지 않았다 — 서류 종류·공통원서 항목·항목 이름이 코드에 박혀 있었다 🔴</sub>
- **D-61** §01 A9 구현 방식(두 시각원·Finalize 만 제외) — [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>§A9 시각 동기화가 없었다 — clock offset 은 늘 0 이었고, 접수 시각은 Pod 시계였다 🔴</sub>

### §03 OpenAPI — 7건

- **D-51** §03 첨부 v1.3.0 교체 — 노션 페이지 수정이 권한 분류기에 막혀(2026-09-30, 외부 시스템 쓰기) 사용자 승인 대기. 올릴 파일·문구는 [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>계약에 요청 한도 응답(429)이 없다</sub>
- **D-55** v1.0 §5.6 전이(`PAID → FINALIZED`, FINALIZING 비저장, EXPIRED 보류)·§03 첨부 v1.4.0 — [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>원서 상태머신이 정의만 있고 흐름에 연결되지 않았다 — 한 원서에 결제창을 몇 개든 열 수 있었다 🔴</sub>
- **D-56** §03 첨부 v1.4.0(FormSchema `profileFields`·`documents`, ConfigDiff `warnings`)  
  <sub>화면이 전형 설정을 다 읽지 않았다 — 서류 종류·공통원서 항목·항목 이름이 코드에 박혀 있었다 🔴</sub>
- **D-57** §03 첨부 v1.4.0(`getMyProfile`·`replaceMyProfile`)  
  <sub>공통원서를 쓰는 길이 개발용 내부 API 뿐이었고, 화면은 가명 토큰을 지어냈다 🔴</sub>
- **D-58** §03 첨부 v1.4.0(`downloadUrl`·`signature`)  
  <sub>서류 검사 엔진이 파일을 읽지 않는 흉내뿐이었고, 검사 기록은 늘 'mock-av' 였다</sub>
- **D-59** §03 첨부 v1.4.0(`getActiveConfig` 본문·`createConfigVersion` 검사 규칙) — [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>운영 콘솔에서 설정 초안을 만들 수 없었고, 보존기간 화면이 없었다</sub>
- **D-60** §03 첨부 v1.4.0(`ApplicationSummary`·이벤트 수신 규칙) — [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>§04 심장박동(sync.heartbeat)을 아무도 보내지 않아 중앙이 조용한 대학과 죽은 대학을 구별하지 못했다 🔴</sub>

### §06 보안정책 — 1건

- **D-53** §06 NetworkPolicy 첨부의 edge 선택자와 §05 Edge 서술 — [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>§06 첨부·차트가 Edge 로 가정한 ingress-nginx 가 은퇴했다</sub>

### §04 CloudEvents — 2건

- **D-47** §04 첨부 교체·본문 패턴 — 노션 페이지 수정이 권한 분류기에 막혀(2026-09-30, 외부 시스템 쓰기) 사용자 승인 대기. 올릴 파일·문구는 [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>CloudEvents subjectRef 계약이 DB 길이보다 긴 키 ID를 허용한다</sub>
- **D-60** §04 본문 — 심장박동 발송·수신 규칙, payment.confirmed 미발송 판정  
  <sub>§04 심장박동(sync.heartbeat)을 아무도 보내지 않아 중앙이 조용한 대학과 죽은 대학을 구별하지 못했다 🔴</sub>

### §07 KRDS — 1건

- **D-43** §07 첨부 교체 — 노션 페이지 수정이 권한 분류기에 막혀(2026-09-30, 외부 시스템 쓰기) 사용자 승인 대기. 올릴 파일·문구는 [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>KRDS 와이어프레임 결제 화면이 "결제 = 접수"(D-42) 와 반대로 안내한다</sub>

### v1.0 본문 — 2건

- **D-55** v1.0 §5.6 전이(`PAID → FINALIZED`, FINALIZING 비저장, EXPIRED 보류)·§03 첨부 v1.4.0 — [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>원서 상태머신이 정의만 있고 흐름에 연결되지 않았다 — 한 원서에 결제창을 몇 개든 열 수 있었다 🔴</sub>
- **D-57** v1.0 §5 공통원서 표준 항목 — [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>공통원서를 쓰는 길이 개발용 내부 API 뿐이었고, 화면은 가명 토큰을 지어냈다 🔴</sub>

### 제출 PDF 정정 — 2건

- **D-2** 정정 문구 준비 완료 — [07-submission-errata.md](07-submission-errata.md). 제출처 반영은 사람
- **D-3** 정정 문구 준비 완료 — [07-submission-errata.md](07-submission-errata.md). 제출처 반영은 사람

### 기타 — 4건

- **D-44** §05 첨부 두 개 교체 — 노션 페이지 수정이 권한 분류기에 막혀(2026-09-30, 외부 시스템 쓰기) 사용자 승인 대기. 올릴 파일·문구는 [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>§05 Helm 첨부(runtime·values-m)가 현재 구현과 다르다</sub>
- **D-49** values-m v1.2 가 `scheduledActivation: ""`·`scheduledEnd: ""`·`window: ""` 와 예약 출처 주석을 담았다(D-44 와 같은 파일). 노션 페이지 수정이 권한 분류기에 막혀(2026-09-30, 외부 시스템 쓰기) 사용자 승인 대기. 올릴 파일·문구는 [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>첨부 values-m 의 예시 예약 시각이 지나면 자동 대조가 영구히 멈춘다</sub>
- **D-52** §08 시나리오 10 합격 기준·§05 노드 장애 흡수 절 — [06-notion-changeset.md](06-notion-changeset.md) (노션 쓰기 승인 대기)  
  <sub>"API 노드 강제 종료 무중단"은 Pod 설정만으로는 지킬 수 없다</sub>
- **D-58** §05 서류 워커 구성(clamd) — [06-notion-changeset.md](06-notion-changeset.md)  
  <sub>서류 검사 엔진이 파일을 읽지 않는 흉내뿐이었고, 검사 기록은 늘 'mock-av' 였다</sub>

<!-- items=16 edits=23 -->
