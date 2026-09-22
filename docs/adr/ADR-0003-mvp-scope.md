# ADR-0003. MVP는 "단일 대학 End-to-End 접수 1건"으로 고정한다

- 상태: 채택 (2026-09-22)

## 맥락
기술설계서 v1.1은 P0 항목만 10종(Deadline Policy, Reconciliation, Autonomous Mode, Peak Mode, two-person config, immutable audit, signed release ...)이다.
전부를 MVP에 넣으면 동작하는 데모가 나오지 않는다.

## 결정
MVP(M2)의 완료 조건을 다음 5개로 고정한다.

1. 공통원서 작성 → 대학 원서 생성(Profile Snapshot) → 자동저장
2. 서류 업로드 → AVAILABLE 전이
3. Sandbox 결제 → 서버측 재검증 → 자동 Finalize → 접수번호 발급
4. 동일 Idempotency-Key 100회 재전송 → Submission 1건
5. central-api 정지 상태에서 1~3 전체 정상 동작, 복구 후 Dashboard 자동 반영

## 근거
5번이 이 제품의 차별성(중앙 비의존성)이 처음으로 증명되는 지점이다. 데모의 하이라이트를 여기에 둔다.
나머지 P0 안전장치는 M3에서 채운다 — 단, **Idempotency / Outbox / 단일 Writer / 서버시간 마감판정**은 나중에 얹을 수 없으므로 M1부터 코드에 박는다.

## 제외 항목
묶음결제, 실 PG 계약, 관리자 콘솔 전체, mTLS/Vault/Istio, Multi-AZ HA·DR, 실명 본인확인, 대교협 연계, Evidence Package 정식 포맷.
