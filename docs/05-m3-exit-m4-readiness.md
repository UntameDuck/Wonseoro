# M3 종료 · M4 착수 준비

> 작성: 2026-09-26
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
| **PG Callback 30분 지연: 자동 정합화** | ❌ **미구현** | 아래 ② G1 |
| 단독 운영자 1명으로 마감시간 변경 불가 | ✅ | API·DB CHECK·관리자 콘솔 화면 (M3 문서) |
| Evidence Package 로 재구성 | ✅ | 콘솔 증적 조회 |
| **운영계정으로 Audit 삭제 불가** | ❌ **미충족** | 아래 ② G2 |
| Production interactive write 경로 없음 (§B16) | 🟡 | 앱 쪽 쓰기 경로는 승인된 Admin API 뿐. **DB 는 슈퍼유저 하나로 열려 있다** — G2 와 함께 |
| 노션 §01 C 8종 대조 | ✅ 대조 완료 | 아래 표 |
| 바뀐 정책 구조를 노션에 반영 | ⬜ **55개 수정 지점 대기** | ③ · 부록 |
| 발견한 불일치를 D-N 으로 등록 | ✅ | D-1 ~ D-41 |

### §01 C 필수 신규 기능 8종 대조

| # | 기능 | 상태 |
|---|---|---|
| C1 | Deadline Policy Engine | ✅ T-M3-01 · 연장 T-M3-14 |
| C2 | Reconciliation Center | 🟡 대조·예외 큐 ✅ — **자동 실행(D+1) 없음**, 사람이 눌러야 돈다 (G1) |
| C3 | Autonomous Mode | 🟡 T-M3-06 — JWKS 캐시만 T-M5-02 |
| C4 | Admission Peak Mode | ⏭ **T-M4-07** 로 이미 잡혀 있다 |
| C5 | Configuration Governance | ✅ T-M3-02 · 서명 T-M3-15 |
| C6 | Evidence Package | ✅ T-M3-07 · 콘솔 |
| C7 | Support Self-check | ✅ M2 (D-16) |
| C8 | Dependency Circuit Breaker | ✅ T-M3-08 |

---

## ② M3 를 닫기 전에 구현해야 하는 것

### G1. 결제 자동 정합화가 없다 (D-40) — **M3 안에서 처리**

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

### G2. 운영계정으로 감사 기록을 지울 수 있다 (D-41) — **M3 안에서 처리**

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

---

## ③ 사람이 내려야 할 결정

코드가 대신 정할 수 없는 것들이다. 정해지지 않으면 해당 부분은 지금 상태로 남는다.

| # | 결정 | 왜 필요한가 | 지금 상태 |
|---|---|---|---|
| 1 | **D-27** 중앙에 가명 지원자 참조를 둘 것인가 | §A3 "최소 정보" 와 충돌할 수 있다 | 둔다 — 목적 키 HMAC 로 (D-39) |
| 2 | **D-29** 원서 자연키 제약을 부분 유니크로 약화 | canonical DDL 제약을 **약화**하는 변경 | 약화함 (취소 후 재지원 허용) |
| 3 | **D-7** 접수 **후** 취소를 어떻게 다룰지 | 원장을 고칠 수 없다. 별도 레코드가 필요한지 | 409 로 거부, 입학처 안내 |
| 4 | **D-38** 보존기간 하한값 | 법정·기관 하한은 개인정보 담당이 정한다 | 관리자 접속기록 2년만 법정, 나머지는 대학이 명시 |
| 5 | **D-30** `system_config` 가 ERD 에만 있고 DDL 에 없음 | 둘 중 하나를 맞춰야 한다 | 쓰지 않음 |
| 6 | **M4 실행 환경** | 수치 인수기준(3,000 CCU · 1,000 RPS · 2시간 단절)은 이 개발 PC 로 못 낸다 (Docker 8GB) | 아래 ④ |
| 7 | **노션 수정 권한** | 55개 수정 지점을 누가 반영하나. 이 세션이 노션에 쓰려면 명시적 허락이 필요하다 | 부록에 페이지별 목록 |

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

## 제안하는 순서

```
1. G1 결제 자동 정합화 (D-40)          ← M3 안. 돈과 접수가 걸린 구멍
2. G2 감사 삭제 불가 · DB 역할 분리 (D-41)
3. M3 종료 체크리스트 마감 · 노션 반영 (결정 ③ 이후)
4. 첨부 3종 배치 · 도구 설치
5. M4 — Helm 차트 → kind 2클러스터 → 대학 간 격리 시험(T-M4-42) → 기능 시험 → (K-PaaS) 수치 시험
```

---

## 부록 — 노션 반영 목록 (자동 생성)

불일치 대장의 "노션 반영 ⬜" 을 노션 문서별로 묶었다. 대장이 원본이고, 이 목록은 `python scripts/notion-changeset.py` 로 다시 만든다.

<!-- 자동 생성: 불일치 대장의 "노션 반영 ⬜" 항목 36건에서 55개 수정 지점 -->

### 먼저 결정·확인이 필요한 것 — 5건

- **D-7** **접수 후 취소를 별도 레코드로 둘지 결정**  
  <sub>Application 상태에 CANCELLED 가 있으나 상태머신에 정의가 없다</sub>
- **D-27** §04 이벤트 스키마와 §10 §9 Dashboard 계약에 반영. **중앙에 가명 식별자를 두는 결정이라 §A3 과 함께 재검토해야 한다**  
  <sub>중앙 요약에 지원자 참조가 없어 Dashboard 가 전체를 돌려준다 🔴</sub>
- **D-29** 🟡 저장소 해소 — 노션 확인 필요 (제약 약화 변경)  
  <sub>취소한 원서가 재지원을 영구히 막았다 🔴</sub>
- **D-30** §02 ERD 와 첨부 DDL 중 어느 쪽이 맞는지 확인  
  <sub>`system_config` 가 canonical DDL 에 없다</sub>
- **D-38** 🟡 판정완료 — 하한값 확인 대기  
  <sub>Retention Matrix 의 하한값이 설계서에 없다</sub>

### §01 운영 리스크 — 9건

- **D-31** §A2 에 "시각 권위는 DB" 를 명시. 애플리케이션 시계로 기록·비교하지 않는다  
  <sub>활성화 시각을 애플리케이션 서버가 찍고 있었다</sub>
- **D-32** §01 C8 에 의존성별 끊김 규칙 표 추가  
  <sub>Circuit Breaker 가 열렸을 때의 규칙이 의존성마다 정해져 있지 않다</sub>
- **D-33** §04 또는 §B7 에 "재시도 한도는 이벤트 단위 실패만 센다" 명시  
  <sub>중앙이 2분 반만 죽어도 Outbox 이벤트가 DEAD 로 떨어졌다 🔴</sub>
- **D-34** §01 A1 의 기능 목록에 단계 표기  
  <sub>Autonomous Mode 의 구성요소가 서로 다른 단계에 걸쳐 있다</sub>
- **D-34** A1/§E 의 단절 시간 기준 통일  
  <sub>Autonomous Mode 의 구성요소가 서로 다른 단계에 걸쳐 있다</sub>
- **D-35** §B17 에 연장 규칙  
  <sub>마감·설정을 "누가 언제 왜 적용했는지" 담을 자리가 DDL 에 없다</sub>
- **D-39** §A12 에 참조 형식·키 교체 규칙  
  <sub>중앙의 지원자 참조가 Vault 와 조인됐고, 대학 내부 UUID 가 중앙에 갔다 🔴</sub>
- **D-40** §A4  
  <sub>결제 자동 정합화가 없다 — 콜백도, 재확인도, 대조 스케줄도 🔴</sub>
- **D-40** §B4 에 "자동 Finalize 하지 않음" 명시  
  <sub>결제 자동 정합화가 없다 — 콜백도, 재확인도, 대조 스케줄도 🔴</sub>

### §02 ERD·DDL — 8건

- **D-14** 중앙 DDL 을 §04 또는 새 절의 첨부로 추가해야 한다. 그래야 다음부터 저장소가 원본이 되지 않는다  
  <sub>중앙 DB 스키마에 canonical DDL 이 없다</sub>
- **D-21** §02 첨부 DDL 에 0002 내용을 접어 넣고 이 파일을 삭제한다. **반영 전까지 마이그레이션이 두 파일로 나뉜다**  
  <sub>config_version 은 단독 승인을 DB 가 막지 않는다</sub>
- **D-23** §02 첨부 DDL 수정  
  <sub>deadline_policy 에 초안 상태를 표현할 컬럼이 없다</sub>
- **D-25** §02 첨부 DDL 에 추가  
  <sub>reconciliation_exception 에 중복 방지 제약이 없다</sub>
- **D-29** §02 첨부 DDL 의 `application` 자연키를 부분 유니크로 변경  
  <sub>취소한 원서가 재지원을 영구히 막았다 🔴</sub>
- **D-35** §02 DDL 에 `activation_record`  
  <sub>마감·설정을 "누가 언제 왜 적용했는지" 담을 자리가 DDL 에 없다</sub>
- **D-38** §02 에 파기 = 내용 제거 명시  
  <sub>Retention Matrix 의 하한값이 설계서에 없다</sub>
- **D-41** §02  
  <sub>운영계정으로 감사 기록을 지울 수 있다 🔴</sub>

### §03 OpenAPI — 15건

- **D-7** §03 OpenAPI 에 `POST /applications/{id}/cancel`  
  <sub>Application 상태에 CANCELLED 가 있으나 상태머신에 정의가 없다</sub>
- **D-16** §03 Applicant API 목록과 첨부 `k-admission-openapi.yaml` 에 추가해야 한다  
  <sub>Support Self-check 가 필수 기능인데 OpenAPI 에 없다</sub>
- **D-17** Vault API 계약을 §03 또는 §10 에 추가. 요청/응답 형태와 동의 범위 전달 방식을 정해야 한다  
  <sub>Common Profile Vault 의 API 가 어디에도 정의되어 있지 않다</sub>
- **D-19** §03 Applicant API 에 추가하고 첨부 yaml 갱신. 또는 `AdmissionType` 에 `formSchema` 를 싣는 방식 중 택일  
  <sub>동적 폼 렌더링에 필요한 Schema 조회 API 가 없다</sub>
- **D-20** §03 Internal API 에 추가하고 첨부 yaml 갱신  
  <sub>AV 검사 워커용 내부 API 가 계약에 없다</sub>
- **D-22** §03 과 첨부 yaml 에 추가  
  <sub>Deadline Policy 에 활성화 API 가 없다</sub>
- **D-24** §03 과 첨부 yaml 에 reason 파라미터 추가  
  <sub>Evidence Package 조회에 사유 파라미터가 없다</sub>
- **D-26** §03 과 첨부 yaml 에 추가  
  <sub>Reconciliation 수동 실행 경로가 계약에 없다</sub>
- **D-28** §03 에 소유권 규칙을 명시하고, §09 STRIDE 의 Information Disclosure 항목에 이 경로를 추가  
  <sub>지원자 API 에 소유권 검사가 없었다 🔴</sub>
- **D-32** §03 OpenAPI 에 위 두 항목  
  <sub>Circuit Breaker 가 열렸을 때의 규칙이 의존성마다 정해져 있지 않다</sub>
- **D-34** §03 OpenAPI 에 operating-mode  
  <sub>Autonomous Mode 의 구성요소가 서로 다른 단계에 걸쳐 있다</sub>
- **D-35** §03 OpenAPI 위 경로  
  <sub>마감·설정을 "누가 언제 왜 적용했는지" 담을 자리가 DDL 에 없다</sub>
- **D-37** §03 OpenAPI 공통 오류에 "본문 인코딩" 명시  
  <sub>깨진 UTF-8 본문이 성공 응답과 함께 저장됐다 🔴</sub>
- **D-39** 대시보드 조회 경로(헤더)  
  <sub>중앙의 지원자 참조가 Vault 와 조인됐고, 대학 내부 UUID 가 중앙에 갔다 🔴</sub>
- **D-40** §03 콜백 경로  
  <sub>결제 자동 정합화가 없다 — 콜백도, 재확인도, 대조 스케줄도 🔴</sub>

### §06 보안정책 — 2건

- **D-37** §06 입력 검증  
  <sub>깨진 UTF-8 본문이 성공 응답과 함께 저장됐다 🔴</sub>
- **D-41** §06 DB 역할 표  
  <sub>운영계정으로 감사 기록을 지울 수 있다 🔴</sub>

### §04 CloudEvents — 3건

- **D-14** 중앙 DDL 을 §04 또는 새 절의 첨부로 추가해야 한다. 그래야 다음부터 저장소가 원본이 되지 않는다  
  <sub>중앙 DB 스키마에 canonical DDL 이 없다</sub>
- **D-33** §04 또는 §B7 에 "재시도 한도는 이벤트 단위 실패만 센다" 명시  
  <sub>중앙이 2분 반만 죽어도 Outbox 이벤트가 DEAD 로 떨어졌다 🔴</sub>
- **D-39** §04 `subjectRef` 형식  
  <sub>중앙의 지원자 참조가 Vault 와 조인됐고, 대학 내부 UUID 가 중앙에 갔다 🔴</sub>

### v1.0 본문 — 11건

- **D-1** v1.0 §6.2 예시 JSON 수정 필요  
  <sub>이벤트 네임스페이스</sub>
- **D-2** v1.0 §12.1 정보구조를 6단계 기준으로 재정리  
  <sub>지원자 흐름 단계 수</sub>
- **D-3** v1.0 §4 기술 스택 표의 Backend 행 수정  
  <sub>백엔드 런타임</sub>
- **D-4** v1.0 §6.2 예시에 확장 속성 표기 추가  
  <sub>Finalized 이벤트의 sequence 위치</sub>
- **D-7** v1.0 §5.6 상태 다이어그램에 취소 전이 추가  
  <sub>Application 상태에 CANCELLED 가 있으나 상태머신에 정의가 없다</sub>
- **D-7** §9 감사 액션 목록  
  <sub>Application 상태에 CANCELLED 가 있으나 상태머신에 정의가 없다</sub>
- **D-15** v1.0 §17.1 의 중앙 수집 목록에 접수번호를 추가하고, 왜 포함되는지 한 줄 근거를 붙인다  
  <sub>접수번호가 중앙에 가는지 문서마다 다르다</sub>
- **D-17** Vault API 계약을 §03 또는 §10 에 추가. 요청/응답 형태와 동의 범위 전달 방식을 정해야 한다  
  <sub>Common Profile Vault 의 API 가 어디에도 정의되어 있지 않다</sub>
- **D-18** §10 §1 표에 "중앙 장애 시 신규 원서는 Snapshot 없이 생성" 을 명시  
  <sub>중앙 장애 시 원서 "생성"이 가능한지가 불명확하다</sub>
- **D-36** v1.0 §9 에 시스템 체인(운영자 행위) 명시  
  <sub>원서에 딸리지 않은 감사 이벤트는 체인이 아니었다 🔴</sub>
- **D-38** v1.0 §9 에 Retention Matrix 표  
  <sub>Retention Matrix 의 하한값이 설계서에 없다</sub>

### 제출 PDF 정정 — 2건

- **D-2** 제출문서 정정 목록
- **D-3** 개발보고서 "팀 기술 스택" 및 설계 서술 정정

<!-- items=36 edits=55 -->
