# admission-api — 대학 Data Plane 메인 API

담당: 송리안 · 근거: 기술설계서 v1.0 §5.2~§5.6, v1.1 §01·§02

**이 서비스가 접수의 System of Record다.** 여기서 커밋된 것만 "접수됨"이다.

## 모듈 (기술설계서 §5 매핑)

| 모듈 | 책임 | 설계서 |
|---|---|---|
| `identity` | 세션 검증, JWKS 로컬 캐시, Autonomous Mode 지속 | v1.1 §A1·§A7 |
| `application` | DRAFT 생성/수정, 자동저장, 추가문항, 서버 마감 검증, version/ETag | v1.0 §5.3 |
| `document-ref` | document-service가 확정한 서류 상태 참조 (AVAILABLE 여부) | v1.0 §5.4 |
| `payment` | PG Adapter, 서버측 재검증, Callback+Polling 이중 확인, UNKNOWN | v1.0 §5.5, v1.1 §A4·§B4 |
| `finalization` | Finalize 트랜잭션. 이 저장소에서 가장 중요한 코드 | v1.0 §5.6, v1.1 §02 |
| `deadline` | Deadline Policy Engine. 서명된 정책 버전으로 마감 판정 | v1.1 §A2 |
| `config` | 버전형 Config, 2인 승인, 예약 활성화, rollback | v1.1 §A14 |
| `audit` | hash-chain append-only 감사 이벤트 | v1.0 §9, v1.1 §A11 |
| `outbox` | 동일 트랜잭션 내 Outbox INSERT (전송은 event-relay 담당) | v1.0 §7.3 |
| `reconciliation` | Application/Payment/Submission/Central 4-way 대조 | v1.1 §A4·§B18 |

## 절대 규칙

1. **Finalize 트랜잭션 안에서 외부 호출 금지.** PG 조회·PDF·SMS·메일·중앙 전송은 커밋 이후.
2. **중앙 전송 실패는 접수 실패가 아니다.** Outbox에 남기고 사용자에게는 접수완료를 반환한다.
3. **마감 판정은 서버시간 + 서명된 DeadlinePolicy로만.** 브라우저 시간 금지, 코드 상수 금지.
4. **모든 mutation은 Idempotency-Key 필수.**
5. **Submission은 application_id UNIQUE.** 중복 접수는 DB 제약으로 막는다.
6. **FINALIZED 이후 일반 사용자 API의 업무필드 수정 경로는 존재하지 않는다.**

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
