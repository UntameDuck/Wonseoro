# 문서 인덱스

## 읽는 순서

| 순서 | 문서 | 언제 읽나 |
|---|---|---|
| 0 | **[03-next-steps.md](03-next-steps.md)** | **지금 무엇을 할 차례인가.** 이어받을 때 여기부터 |
| 1 | **[01-notion-sync-protocol.md](01-notion-sync-protocol.md)** | **작업 시작 전 무조건.** 노션을 언제·어떻게 확인하고 고치는지 |
| 2 | [00-development-plan.md](00-development-plan.md) | 전체 그림 — 7단계 구성, 역할 분담, MVP 범위, DoD |
| 3 | [milestones/](milestones/) | 지금 하는 단계의 세부 태스크 |
| 4 | [adr/](adr/) | 왜 이렇게 정했는지 |
| 5 | [02-spec-discrepancy-register.md](02-spec-discrepancy-register.md) | 문서 간 충돌이 의심될 때 |
| 6 | [04-production-readiness.md](04-production-readiness.md) | 운영에 올리기 전 무엇을 점검했는지 |
| 7 | [05-m3-exit-m4-readiness.md](05-m3-exit-m4-readiness.md) | M3 종료 체크리스트 실제 상태 · 결정 사항 · M4 준비물 · 노션 반영 목록 |
| 7 | [spec-assets/README.md](spec-assets/README.md) | 노션 첨부 배치 현황 |

## 마일스톤 (총 7단계)

| 단계 | 문서 | 태스크 | 1줄 목표 |
|---|---|---|---|
| M0 | [기반 구축](milestones/M0-foundation.md) | 8 | 두 사람이 각자 시작할 수 있게 |
| M1 | [접수 Core](milestones/M1-admission-core.md) | 14 | 원서를 만들고 저장하고 검증 |
| M2 | [결제·Finalize·화면](milestones/M2-payment-finalize-mvp.md) | 24 | **화면에서 접수번호를 받는다 (MVP)** |
| M3 | [운영 안전장치](milestones/M3-operational-safeguards.md) | 15 | 장애가 나도 판정 가능하게 |
| M4 | [분산 실증](milestones/M4-federated-proof.md) | 25 | 장애 격리를 숫자로 증명 |
| M5 | [신뢰성·보안·접근성](milestones/M5-reliability-security.md) | 33 | 대학에 넣을 수 있는 수준 |
| M6 | [Pilot 준비](milestones/M6-pilot-readiness.md) | 15 | 대학 1곳 Shadow Test |

총 **139개 태스크, 50개 완료 (2026-09-23)**. 각 태스크에 담당·근거 노션 절·인수기준이 붙어 있다.

| 단계 | 진행 |
|---|---|
| M0 기반 | 7/8 |
| M1 접수 Core | 14/14 ✅ |
| M2 결제·Finalize·화면 | 24/24 ✅ |
| M3 운영 안전장치 | 6/15 ◀ 진행 중 |
| M4~M6 | 0/78 |

진행 현황과 다음 착수 순서는 **[03-next-steps.md](03-next-steps.md)** 를 본다.

## 각 마일스톤 문서의 구조

```
목표 / 완료 기준 / 선행 조건 / 담당
  ↓
노션 확인 대상          ← 이 단계에서 읽어야 할 노션 문서와 이유
  ↓
태스크 표               ← ID · 태스크 · 담당 · 근거 노션 · 인수기준
  ↓
태스크 상세             ← 중요 태스크의 구현 규칙과 금지사항
  ↓
종료 체크리스트         ← 노션 갱신 항목 포함. 안 채우면 다음 단계 착수 금지
```

## 규칙 요약

1. 태스크 착수 전 `근거 노션` 절을 다시 읽는다
2. 태스크 완료 시 코드↔설계가 어긋나면 **둘 중 하나를 반드시 고친다**
3. 마일스톤 종료 시 노션 전체를 다시 읽고 종료 체크리스트를 채운다
4. 불일치는 조용히 고치지 말고 대장에 등록한다
5. 노션 첨부파일이 canonical — 저장소에서 새로 쓰지 않는다
