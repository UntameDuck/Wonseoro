# central-api — 중앙 Control + Convenience Plane

담당: 송리안(Control) / 권민준(Convenience) · 근거: 기술설계서 v1.0 §3.1, v1.1 §10

**이 서비스는 지원자 요청의 Critical Path에 들어가지 않는다.** 죽어도 대학 접수는 계속되어야 한다.

## 모듈

| 모듈 | Plane | 책임 | 상태 (2026-09-30) |
|---|---|---|---|
| `sync-gateway` | Control | 대학 Event 수신, `source+id` dedup, sequence gap 탐지, **대학 심장박동**(§04, D-60), 대학별 상태 `GET /internal/v1/sync/status` | ✅ — 발신 신원 확인(mTLS)은 M5 |
| `profile-vault` | Convenience | 공통원서 — 지원자용 `GET·PUT /api/v1/profile`(D-57), 대학용 동의 기반 Snapshot `POST /internal/v1/profile-snapshots` | ✅ — 표준 항목 `@wonseoro/contracts` `COMMON_PROFILE_FIELDS` |
| `dashboard` | Convenience | 내 원서 요약 (대학 Event로만 갱신, 실시간 대학 DB 조회 금지), 대학별 연결 상태 | ✅ |
| `registry` | Control | University / Schema / Release / Policy Registry | 🟡 `university_registry` 표만 — 등록된 ACTIVE 대학의 이벤트만 받는다 |
| `observability` | Control | PII 제거된 Metrics·SLO 집계, Incident Console | 🟡 계측(`server-kit`)만. Incident Console 은 없다 |
| `catalog` | Convenience | 대학·전형·모집단위 검색, 모집요강 | ⬜ 없음 — 카탈로그 원본은 각 대학 Data Plane 이 준다(중앙 장애에도 대학 직접 접수) |
| `competition` | Convenience | 경쟁률 Snapshot 캐시 (실시간 COUNT 금지) | ⬜ 없음 |

신원: `AUTH_MODE=dev-headers`(개발 — `x-subject-token` 을 믿는다) | `gateway`(`x-authenticated-subject`). **운영에서 dev-headers 면 기동하지 않는다.**
JSON 본문은 UTF-8 이 아니면 400 이다(D-37 과 같은 규칙).

## 절대 규칙

1. **중앙 DB로 접수 여부를 판정하지 않는다.** 표시할 때는 `observed status + sync lag`를 함께 보여준다.
2. **Dashboard는 대학 DB를 화면조회마다 호출하지 않는다.** State Event로 갱신된 Summary Store를 읽는다.
2-1. **Dashboard는 본인 것만 돌려준다.** 신원 헤더 없는 요청은 400이다.
     요약에는 `subject_ref`(= `<keyId>.<HMAC("DASHBOARD"|subject_token)>`, 목적 키)가 붙고 그것으로 거른다.
     키 없는 해시였을 때는 Vault 가 토큰을 해시해 요약과 조인할 수 있었다 — 목적 키는 대학과 대시보드만 갖는다. (D-27 · D-39)
     대학별 소금을 섞지 않아 같은 사람이면 대학이 달라도 같은 값이 나온다.
2-2. **심장박동이 끊긴 대학은 "확인 불가" 로 보인다**(`universityReachable: false`). 접수가 실패했다는 뜻이 아니다 — 대학 DB 가 원장이다. (D-60)
3. **경쟁률은 Snapshot/Cache에서만.** 대학 Application DB에 COUNT를 날리지 않는다.
4. **중앙에 PII를 모으지 않는다.** 원본 식별자 검색 기능을 만들지 않는다.
