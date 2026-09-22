# 원서로 (K-Admission)

**K-PaaS 기반 분산형 대학입학 원서접수 표준 플랫폼**
2026년 GovTech 창업경진대회 · 21st ARK (송리안 · 권민준)

> 중앙을 없애는 것이 아니라, **중앙에서 Critical Traffic을 제거한다.**
> Convenience는 중앙화하고, Compute·Write·Finalization은 대학별로 분산한다.

---

## 아키텍처 한 줄

| Plane | 무엇을 하나 | 죽으면 |
|---|---|---|
| **Convenience** (중앙) | 공통원서, 대학·전형 검색, 내 원서 Dashboard, 경쟁률 | 검색·통합조회만 제한. **대학 접수는 계속된다** |
| **Control** (중앙) | 표준·배포·보안정책·관제 | 신규 배포만 중단. 기존 Runtime 정상 |
| **University Data** (대학별) | Draft 자동저장, 서류, 결제검증, **Finalize**, 접수번호 | 해당 대학만 영향 |

**최종 접수 여부의 System of Record는 대학 DB다.** 중앙 조회 결과로 접수 여부를 판정하지 않는다.

---

## 저장소 구조

```
apps/admission-api/       대학 Data Plane 메인 API — 접수의 System of Record
apps/document-service/    서류 (Presigned Upload · 재검증 · AV)
apps/event-relay/         Outbox → 중앙 Sync
apps/central-api/         중앙 Control + Convenience Plane
apps/frontend/            지원자 웹 (Next.js + KRDS, 6단계)
packages/contracts/       OpenAPI · CloudEvents · 상태머신 · 감사 스키마 ← 유일한 공유 지점
deploy/                   Helm · GitOps · 대학별 values
infra/                    로컬 Compose · DB 마이그레이션
tests/load/               k6 부하·장애·복구 시나리오
docs/                     개발 플랜 · ADR · 설계서 첨부 배치표
```

## 시작하기

```bash
npm install
npm run dev:infra        # postgres(대학/중앙 분리) + redis + minio
npm run dev:university   # admission-api  :3001
npm run dev:central      # central-api    :3000
npm run dev:web          # frontend       :4000
```

헬스체크: `curl localhost:3001/healthz`

## 읽는 순서

1. [개발 플랜](docs/00-development-plan.md) — 마일스톤 · MVP 범위 · 역할 분담 · 백로그
2. [ADR](docs/adr/) — 확정된 기술 결정과 근거
3. [설계서 첨부 배치표](docs/spec-assets/README.md) — **M1 착수 전 선행 작업**
4. 각 앱의 `README.md` — 해당 서비스의 절대 규칙

상위 설계 문서는 Notion `K-Admission 기술설계서 v1.0 / v1.1`이다. 아키텍처 원칙은 그쪽이 상위 문서다.

## 타협하지 않는 규칙

1. Finalize 트랜잭션 안에서 외부 호출 금지 (PG·PDF·SMS·메일·중앙 전송은 커밋 이후)
2. 중앙 전송 실패는 접수 실패가 아니다
3. 마감 판정은 서버시간 + 서명된 DeadlinePolicy로만 — 브라우저 시간 금지, 코드 상수 금지
4. 모든 mutation은 `Idempotency-Key` 필수
5. 로그·Metrics Label·Trace Span에 개인정보 금지
6. 대학별 code fork 금지 — 차이는 Config + JSON Schema + Feature Flag로만
