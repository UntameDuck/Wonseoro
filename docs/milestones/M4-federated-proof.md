# M4 — 분산 실증

| | |
|---|---|
| **목표** | "한 대학 장애가 다른 대학으로 번지지 않는다"를 **숫자로** 증명한다 |
| **완료 기준** | 3,000 CCU + 1,000 RPS Burst 통과, 중앙 2시간 단절 이벤트 손실 0, DB Failover 중복 접수 0 |
| **선행 조건** | M3 종료 체크리스트 완료 |
| **주 담당** | 송리안 (K-PaaS·Helm) / 권민준 (부하 스크립트·관측성) / 테스트는 **공동 페어** |

> M4는 **검증 단계지 설계 단계가 아니다.** 여기서 구조 결함이 나오면 M1까지 되돌아간다.
> 그래서 Idempotency·Outbox·단일 Writer·서버시간 마감판정을 M1부터 코드에 박아둔 것이다.

## 노션 확인 대상

| 문서 | 이 단계에서 보는 이유 |
|---|---|
| [08. 부하·장애·복구 테스트](https://app.notion.com/p/3df75ab5debe81edb65cf9ecaf4e2b89) | **이 단계의 주 설계서.** 시나리오 12종, Acceptance |
| [05. Kubernetes·Helm·GitOps](https://app.notion.com/p/3df75ab5debe811cac32ec1c98d50d59) | 차트 구조, Runtime 기준, Release 파이프라인 |
| [v1.0 §10](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | Size Profile, SLO, DR 목표, 마감일 특별모드 |
| [01. 운영 리스크](https://app.notion.com/p/3df75ab5debe813c87fceef73f0d74e8) | B1(Cold Start)·B2(Connection Storm)·A10(Split-brain)·B13 |
| [10. 트래픽 분산](https://app.notion.com/p/3df75ab5debe8143b651d8aef608a0a5) | §11 URL·라우팅, §13 장애 시 처리 |

## 태스크

### 배포 (송리안)

| ID | 태스크 | 근거 노션 | 인수기준 |
|---|---|---|---|
| T-M4-01 | Helm 차트 작성 | §05 | `charts/k-admission/` + values-s/m/l |
| T-M4-02 | Runtime 보안 기준 적용 | §05 | runAsNonRoot·readOnlyRootFS·seccomp·drop ALL·PDB·probe |
| T-M4-03 | 대학별 values 분리 | §05, §01 A5 | UNIV-A/B/C, **code fork 0** |
| T-M4-04 | K-PaaS 또는 kind 2~3 클러스터 | §05 | 대학별 독립 Data Plane 기동 |
| T-M4-05 | GitOps Pull 배포 | v1.0 §13.1 | 중앙에서 Push하지 않음, Signed Artifact Pull |
| T-M4-06 | DB를 클러스터 밖 HA 계층으로 | §05 | Primary/Standby, PITR |
| T-M4-07 | **Admission Peak Mode** | §01 B1·C4 | D-1 사전확장, minReplica 상향, 비핵심 Job 억제 |
| T-M4-08 | HPA 커스텀 지표 | §05 | CPU뿐 아니라 RPS/Latency/Queue |
| T-M4-09 | PgBouncer 계열 Pooler | §01 B2 | Connection Storm 차단, 전체 budget 고정 |
| T-M4-10 | Outbox Partition/Archive | §01 B7 | 장기 장애 시 디스크 고갈 방지 |

### 관측성 (권민준)

| ID | 태스크 | 근거 노션 | 인수기준 |
|---|---|---|---|
| T-M4-20 | OpenTelemetry 계측 | v1.0 §15 | Metrics/Trace/Log, **PII 금지** |
| T-M4-21 | Golden Signals 대시보드 | v1.0 §15 | Traffic·Errors·Latency·Saturation |
| T-M4-22 | 업무 KPI 대시보드 | v1.0 §15 | finalize_success_rate, outbox_oldest_age_seconds, central_sync_lag_seconds 등 7종 |
| T-M4-23 | Support Dashboard 고정 지표 | v1.0 §10.4 | finalize success rate·payment verify latency·outbox backlog·DB lock wait·error rate |
| T-M4-24 | Log Masking SDK 강제 | §01 B8 | Body Logging 기본 off, Telemetry allowlist |

### 테스트 (공동 페어)

노션 §08 시나리오 12종을 그대로 수행한다.

| ID | 시나리오 | 통과 기준 |
|---|---|---|
| T-M4-30 | 1. Baseline 500 VU 30분 | Read p95 ≤300ms |
| T-M4-31 | 2. Expected Peak 1,500 VU 30분 | Draft Save p95 ≤500ms |
| T-M4-32 | 3. **Deadline Flash Crowd 3,000 VU + 1,000 RPS** | 핵심 Endpoint SLO 충족 |
| T-M4-33 | 4. 동일 Application Finalize 100회 동시 | **duplicate Submission 0** |
| T-M4-34 | 5. PG p95 10초 / 5% timeout / callback 1~30분 지연 | 자동 정합화, double-confirm 0 |
| T-M4-35 | 6. **Central Sync 2시간 차단** | **event loss 0**, 접수 지속 |
| T-M4-36 | 7. Peak 70% 부하에서 DB Primary Failover | 중복 접수 0, 자동 복구 |
| T-M4-37 | 8. Redis Failover / Cache 초기화 | 세션·접수 영향 확인 |
| T-M4-38 | 9. Object Storage 지연 | 서류 외 흐름 지속 |
| T-M4-39 | 10. API Node 강제 종료 | 무중단 |
| T-M4-40 | 11. Bot/Abuse + 학교 NAT 정상사용자 동시 | **NAT 사용자 차단 0** (§01 B6) |
| T-M4-41 | 12. 6시간 Soak | 메모리·커넥션 누수 없음 |
| T-M4-42 | **대학 간 장애 격리 검증** | A대 전면 장애 중 B·C대 접수 정상 |

## 태스크 상세

### T-M4-42 — 대학 간 장애 격리 ⭐ 이 제품의 존재 이유

노션 §08 시나리오에는 명시되어 있지 않지만, **이 제품의 핵심 주장을 증명하는 시험**이다.
결과를 노션 §08에 시나리오 13으로 추가한다.

```
A대 Data Plane 전면 정지
  → B대·C대 접수 흐름 전 구간 정상 (작성·저장·결제·Finalize)
  → 중앙 Dashboard는 A대만 "확인 불가"로 표시
  → A대 복구 후 Outbox 자동 재전송, 손실 0
```

측정: B·C대의 p95 지연 변화가 A대 장애 전후로 유의미하게 증가하지 않을 것.

### T-M4-40 — NAT 문제 (§01 B6)

한 고등학교 전체가 같은 공인 IP로 나온다. **IP 단독 rate-limit을 걸면 정상 수험생이 통째로 차단된다.**

- session/account/application 기반 위험점수 → Adaptive Throttling
- CAPTCHA는 고위험 요청에만, 접근 가능한 대체수단 제공
- 검증: NAT 뒤 정상 사용자 200명 + 봇 트래픽 동시 → 정상 사용자 차단 0

### T-M4-07 — Admission Peak Mode (§01 B1)

HPA 반응을 기다리면 이미 늦는다.
```
D-1      : API/DB/Redis 사전 Scale-out
마감 6시간 전: Feature Freeze, 비핵심 Job Queue 우선순위 하향
마감 1시간 전: autoscaler minReplica 상향
상시      : DB Connection Pool 상한 고정 (Connection Storm 차단)
```

## 종료 체크리스트 — 노션 §08 Acceptance

- [ ] Read p95 ≤ 300ms
- [ ] Draft Save p95 ≤ 500ms
- [ ] Finalize 내부처리 p95 ≤ 1.5s (외부 PG 제외)
- [ ] 업무 Validation 제외 Error < 0.1%
- [ ] duplicate Submission 0 / Payment double-confirm 0
- [ ] Central event loss 0 / Sequence gap 미복구 0
- [ ] Central outage 중 핵심접수 지속
- [ ] DB failover 후 자동 복구
- [ ] **대학 간 장애 격리 증명** (T-M4-42)
- [ ] **실측값으로 노션 v1.0 §10.1 Size Profile 보정** — 추정치를 실측으로 교체
- [ ] **노션 §08에 시나리오 13(대학 간 격리) 추가**
- [ ] Helm values 기본값을 실측 기준으로 조정하고 §05 첨부 갱신
- [ ] 발견한 불일치를 D-N으로 등록·처리
