# admission-api — 대학 Data Plane 메인 API

담당: 송리안 · 근거: 기술설계서 v1.0 §5.2~§5.6, v1.1 §01·§02

**이 서비스가 접수의 System of Record다.** 여기서 커밋된 것만 "접수됨"이다.

## 모듈 (기술설계서 §5 매핑)

| 모듈 | 책임 | 설계서 |
|---|---|---|
| `common/identity` | 호출자 신원 해석 + **자원별 소유권 확인**. 운영 API 문지기 | v1.0 §8.3, v1.1 §06·§09 |
| `common/idempotency` | 모든 mutation 의 Idempotency-Key 강제, 응답 재생, 만료 기록 정리 | v1.1 §02 |
| `common/time` | 노드–DB 시계 offset 측정, DB 시계에 맞춘 "지금", 초과 노드 Finalize 거절 | v1.1 §A2·§A9 (D-61) |
| `common/throttle` | 지원자 단위 Adaptive Throttling | v1.1 §B6 (ADR-0007) |
| `application` | 원서 생성/수정, 자동저장, 추가문항, 서버 마감 검증, version/ETag, **상태 전이**(`transitionApplication`) | v1.0 §5.3·§5.6 (D-55) |
| `document` | 업로드 의도·완료·magic-byte·해시 검증, 검사 결과 반영(엔진·버전 기록). 작성 중 원서·설정의 서류 종류만 | v1.0 §5.4 (D-56·D-58) |
| `payment` | PG Adapter, 서버측 재검증, Callback+Polling 이중 확인, UNKNOWN, **한 원서 한 결제** | v1.0 §5.5, v1.1 §A4·§B4 (D-55) |
| `finalization` | Finalize 트랜잭션(커밋 시각 = DB 시계). Outbox INSERT 도 여기다 — 전송은 event-relay | v1.0 §5.6·§7.3, v1.1 §02 |
| `deadline` | Deadline Policy Engine. 서명된 정책 버전으로 마감 판정 | v1.1 §A2 |
| `config` | 버전형 Config, 2인 승인 + **Diff 확인 승인**, 예약 활성화, Rollback, Freeze, **Config Linter**, 추가문항 스키마 | v1.1 §A5·§A14 (D-56) |
| `cancellation` | 접수 성립 **전** 취소. 환불은 자동으로 하지 않는다 | 불일치 대장 D-7 |
| `evidence` | 한 원서의 접수 과정 재구성 + 감사 체인 검증 | v1.1 §A11·§C6 |
| `audit` | hash-chain append-only 감사 이벤트 | v1.0 §9, v1.1 §A11 |
| `reconciliation` | Application/Payment/Submission/Central 4-way 대조 + **PG 정산 대조** | v1.1 §A4·§B18 (D-55) |
| `catalog` · `meta` · `operating-mode` · `retention` · `activation` | 카탈로그, 서버 시각·Self-check·헬스, 자율 운영 모드, 보존 계획, 서명된 활성화 기록 | |

## 절대 규칙

1. **Finalize 트랜잭션 안에서 외부 호출 금지.** PG 조회·PDF·SMS·메일·중앙 전송은 커밋 이후.
2. **중앙 전송 실패는 접수 실패가 아니다.** Outbox에 남기고 사용자에게는 접수완료를 반환한다.
3. **마감 판정은 서버시간 + 서명된 DeadlinePolicy로만.** 브라우저 시간 금지, 코드 상수 금지.
4. **모든 mutation은 Idempotency-Key 필수.**
5. **Submission은 application_id UNIQUE.** 중복 접수는 DB 제약으로 막는다.
6. **FINALIZED 이후 일반 사용자 API의 업무필드 수정 경로는 존재하지 않는다.**
7. **모든 지원자 경로에서 소유권을 확인한다.** 조회도 예외가 아니다 — 원서 본문에는
   자기소개서가 들어 있다. 없는 자원과 남의 자원은 **같은 응답**으로 돌려준다.
   구분해 주면 식별자를 훑어 유효한 원서를 찾아낼 수 있다. (D-28)
8. **설정은 기동 시점에 확정한다.** 쓰는 자리에서 `process.env` 를 읽지 않는다.
   그렇게 하면 설정이 빠진 것을 그 코드가 처음 실행될 때에야 알게 된다.
9. **원서 상태는 `transitionApplication` 으로만 바꾼다** — 전이 표(`@wonseoro/contracts`)가 허용하는 것만, 조건부 UPDATE 로. (D-55)
10. **한 원서에 살아 있는 결제는 하나다.** 결제를 시작한 원서(PAYMENT_PENDING)는 고칠 수 없다. (D-55)
11. **시각의 권위는 DB 다.** 접수 커밋 시각은 트랜잭션 안에서 DB 에 묻고, 그 밖의 시각은 `serverNow()`(DB 시계에 맞춘 값)를 쓴다 — `new Date()` 로 판정하지 않는다. (§A2, D-61)
12. **새 provider 는 AppModule 조립 시험(`app.module.boot.test.ts`)이 확인한다.** 생성자 기본값 인자는 DI 가 풀지 못해 서버가 뜨지 않는다 — 통합 시험은 서비스를 직접 만들어 이것을 못 잡는다.

## 운영 API (`/admin/v1`)

마감시각 변경·설정 활성화·PII 열람·불일치 해소가 이 뒤에 있다.
인증은 M5(T-M5-10)이고, 그때까지는 `Authorization: Bearer <ADMIN_API_TOKEN>` 이
최소한의 문이다. **인증이 아니다** — 공유 비밀 하나라 누가 했는지 구분하지 못한다.
그래서 감사에는 `x-admin-id` 를 따로 남긴다. 문과 기록은 다른 문제다.

운영 모드에서 `ADMIN_API_TOKEN` 이 없으면 프로세스가 기동하지 않는다.

## Finalize 트랜잭션 순서 (v1.1 §02)

```
1. Idempotency record 확인/잠금
2. Application 상태·버전·마감정책 확인
3. 사전 검증된 Payment snapshot 확인   ← PG 재조회는 이 단계 이전에 끝나 있어야 함
4. Submission INSERT
5. Application → FINALIZED 조건부 전이
6. Outbox Event INSERT
7. Audit Event INSERT
8. Commit
```
