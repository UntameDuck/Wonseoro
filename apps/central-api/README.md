# central-api — 중앙 Control + Convenience Plane

담당: 송리안(Control) / 권민준(Convenience) · 근거: 기술설계서 v1.0 §3.1, v1.1 §10

**이 서비스는 지원자 요청의 Critical Path에 들어가지 않는다.** 죽어도 대학 접수는 계속되어야 한다.

## 모듈

| 모듈 | Plane | 책임 |
|---|---|---|
| `registry` | Control | University / Schema / Release / Policy Registry |
| `sync-gateway` | Control | 대학 Event 수신, `source+id` dedup, 서명검증, sequence gap 탐지 |
| `observability` | Control | PII 제거된 Metrics·SLO 집계, Incident Console |
| `catalog` | Convenience | 대학·전형·모집단위 검색, 모집요강, 마감정보 |
| `profile-vault` | Convenience | Common Profile Vault, 동의 기반 필드 Snapshot 제공 |
| `dashboard` | Convenience | 내 원서 요약 (대학 Event로만 갱신, 실시간 대학 DB 조회 금지) |
| `competition` | Convenience | 경쟁률 Snapshot 캐시 (실시간 COUNT 금지) |

## 절대 규칙

1. **중앙 DB로 접수 여부를 판정하지 않는다.** 표시할 때는 `observed status + sync lag`를 함께 보여준다.
2. **Dashboard는 대학 DB를 화면조회마다 호출하지 않는다.** State Event로 갱신된 Summary Store를 읽는다.
2-1. **Dashboard는 본인 것만 돌려준다.** `applicantToken` 없는 요청은 400이다.
     요약에는 `subject_ref`(= sha256(subject_token))가 붙고 그것으로 거른다.
     원문 토큰이 아니라 해시라 요약이 Vault와 직접 조인되지 않고, 대학별 소금을
     섞지 않아 같은 사람이면 대학이 달라도 같은 값이 나온다. (D-27)
     빈 목록을 주지 않는 이유는 "접수된 원서가 없다"로 읽혀 재접수를 시도하기 때문이다.
3. **경쟁률은 Snapshot/Cache에서만.** 대학 Application DB에 COUNT를 날리지 않는다.
4. **중앙에 PII를 모으지 않는다.** 원본 식별자 검색 기능을 만들지 않는다.
