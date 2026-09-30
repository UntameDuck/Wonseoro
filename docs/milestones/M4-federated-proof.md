# M4 — 분산 실증

| | |
|---|---|
| **목표** | "한 대학 장애가 다른 대학으로 번지지 않는다"를 **숫자로** 증명한다 |
| **완료 기준** | 3,000 CCU + 1,000 RPS Burst 통과, 중앙 2시간 단절 이벤트 손실 0, DB Failover 중복 접수 0 |
| **선행 조건** | M3 종료 체크리스트 완료 · 첨부 3종(k6·values-m·runtime) · kind·helm·k6 — [준비 문서](../05-m3-exit-m4-readiness.md) ④ |
| **주 담당** | 송리안 (K-PaaS·Helm) / 권민준 (부하 스크립트·관측성) / 테스트는 **공동 페어** |

> M4는 **검증 단계지 설계 단계가 아니다.** 여기서 구조 결함이 나오면 M1까지 되돌아간다.
> 그래서 Idempotency·Outbox·단일 Writer·서버시간 마감판정을 M1부터 코드에 박아둔 것이다.

## 진행 현황 (2026-09-30)

| ID | 상태 | 근거 |
|---|---|---|
| T-M4-01 Helm 차트 | ✅ | `deploy/charts/k-admission` — values-s/m/l (s·l 은 파생값). **values-m v1.2(2026-09-30)** 를 차트에 맞췄고 runtime 첨부는 차트 렌더링 결과로 만든다(`scripts/render-runtime-attachment.mjs`, CI `--check`·`helm lint`). 노션 §05 첨부 교체는 승인 대기(D-44) |
| T-M4-02 Runtime 보안 기준 | ✅ | runAsNonRoot(UID 10001)·readOnlyRootFS·seccomp·drop ALL·PDB·startup/readiness/liveness. 이미지를 같은 조건으로 띄워 확인 |
| T-M4-03 대학별 values | ✅ | `deploy/universities/UNIV-A·B·C` — 같은 차트·같은 이미지, **마감·설정 버전은 values 에 없다**(D-44 ⑥) |
| T-M4-04 kind 2 클러스터 | ✅ | univ-a·univ-b의 API 2개·Relay·서류 워커 모두 Ready. 서류 워커 수정 이미지 재배포·NetworkPolicy 실효성 확인 |
| T-M4-05 GitOps Pull | ✅ | Flux 2.9.5가 signed Git HEAD만 Pull하고 namespace 한정 ServiceAccount로 HelmRelease를 수렴한다. unsigned HEAD 거부·last-good 유지·Helm v25 적용·replica drift 1→2 복구 확인. 로컬 축소 결과 `tests/m4/results/gitops-pull-2026-09-29T04-24-15-000Z.json` |
| T-M4-07 Peak Mode | ✅ | 대학별 `peak-schedule.yaml`(사전 확장·작업 억제·종료)을 예약 워크플로가 `peak-mode.yaml` overlay 로 바꿔 서명 커밋하고 Flux 가 Pull 한다(ADR-0006, D-48). 앱은 억제 시각~종료 시각에만 자동 대조를 멈춘다. 로컬 축소 환경에서 API replica 2→3 전환(push 뒤 62초)·원복(33초)·SourceVerified 유지 확인 `tests/m4/results/peak-mode-gitops-2026-09-29T11-43-36-484Z.json`. GitHub 예약 워크플로 실행과 DB·Redis 사전 확장(클러스터 밖 HA 계층, T-M4-06)은 미검증 |
| T-M4-08 HPA 커스텀 지표 | ✅ | Prometheus가 API Pod 지표를 수집하고 Adapter가 RPS·p95 지연·처리 중 요청 수를 Custom Metrics API로 제공한다. 임시 HPA에서 세 지표와 `ScalingActive=True/ValidMetricFound` 확인 후 로컬 HPA 원복. 로컬 축소 결과 `tests/m4/results/hpa-custom-metrics-2026-09-29T03-27-10-000Z.json` |
| T-M4-09 커넥션 예산 | ✅ | PgBouncer 1.26.0 비루트 이미지·Helm Deployment/PDB·앱/DB TLS 경계·서버/클라이언트 예산·직접 DB 우회 차단. 동시 30쿼리 성공, upstream 최대 10/10. 노드 강제 재시작 후 stale PID 자동 제거·A 전체 Ready 복구와 B 정상 유지 확인. 로컬 축소 환경 결과 `tests/m4/results/pgbouncer-2026-09-28T01-26-13-047Z.json`. D-44 ⑦ 결정(2026-09-30): Pod 당 38·예산 400 유지 — 최대 391 |
| T-M4-20 OpenTelemetry | ✅ | 네 서비스(API·Relay·서류 워커·중앙)가 공용 `server-kit` 계측을 쓴다 — Prometheus 지표, OTLP/gRPC Trace, 내부 호출 traceparent 전파(Relay→중앙·워커→API·API→Vault), 한 줄 JSON 로그의 trace_id/span_id. HTTP 라벨·span 속성은 allowlist(메서드·라우트 템플릿·상태 코드, 식별자 형태 값)만 쓴다. smoke(모의 수집기)에서 Trace·로그 상관관계·PII 미노출, Relay 통합 시험에서 이벤트 span→중앙 헤더 전파, kind A 에서 세 워크로드 수집 up=1·구조화 로그 확인 `tests/m4/results/telemetry-kind-2026-09-29T14-05-37-946Z.json`. 로컬에 수집기가 없어 클러스터 안 Trace 전송은 미검증 |
| T-M4-24 Log Masking 강제 | ✅ | `StructuredLogger` — 본문 객체 미기록, 주민번호·전화·이메일·카드·토큰·접속 비밀번호 마스킹, 운영 스택 없음. 전역 Nest 로거를 기동 전에 교체하고, `scripts/check-logging.mjs` 가 console·stdout 직접 출력과 로거 누락을 CI 에서 막는다 |
| T-M4-21 Golden Signals 대시보드 | ✅ | `deploy/platform/observability/dashboards/golden-signals.json` — Traffic(서비스별 RPS·Finalize TPS)·Errors(5xx 비율·상태별)·Latency(p95, probe 제외)·Saturation(처리 중 요청·DB 잠금 대기·Outbox 적체). 로컬 Grafana 12.3.1 에서 렌더링 확인 `tests/m4/results/grafana-dashboards-2026-09-29T15-52-02-577Z.json` |
| T-M4-22 업무 KPI | ✅ | §15 7종 — 결과별 카운터·DB 게이지를 앱이 내고 비율은 recording rule(`kpi-rules.yaml`)에서 한 번만 정의(업무 거절·충돌은 분모 제외). kind 에서 원서 12건 흐름의 카운터(저장 saved·conflict·rejected 각 12, 결제 verified 12, 자동 접수 finalized 12·화면 재제출 already_finalized 12)와 규칙 14개 값 확인 `tests/m4/results/business-kpi-kind-2026-09-29T15-14-52-238Z.json`. 이 확인에서 취소 이벤트 계약 위반(D-50)을 찾아 고쳤다 |
| T-M4-23 Support Dashboard | ✅ | §10.4 고정 5종 `dashboards/support.json` — Grafana 에서 finalize success rate 100%·payment verify latency p95 450ms·outbox backlog 0·DB lock wait 0·error rate 0% 표시(축소 환경 값). 대시보드↔규칙 일관성·설계서 지표 누락 검사 `tests/m4/dashboards.mjs` CI 포함 |
| T-M4-40 NAT·봇 공존 | ✅ | 지원자 단위 Adaptive Throttling(ADR-0007) — IP 를 키로 쓰지 않고 지원자×요청 종류 토큰 버킷 + 위험점수(소유권 검사 실패·다수 원서·한도 초과, 5분 반감기). 정상 세션의 최종제출은 막지 않는다. kind A 에서 단일 출발지(NAT) 정상 200명 + 봇 5개 90초를 세 번 돌려 **세 번 모두 정상 사용자 429 = 0**, 봇 요청 78~85% 거절 `tests/m4/results/nat-bot-kind-*.json`. 두 번째 실행은 전부 통과(200명 접수·오류 0). 첫·세 번째 실행에서 과부하 중 **멱등 기록 실패가 API 프로세스를 죽이는 결함**이 드러나 고쳤다(DB 풀 포화는 503 재시도 안내로). 수정 이미지로 네 번 더 돌려 **재시작 0·정상 사용자 429 0** 을 확인했다(최종 `nat-bot-kind-2026-09-29T17-13-42-873Z.json` PASS). 봇 없는 기준 실행에서도 같은 DB 풀 포화가 나 — 5xx·지연은 축소 환경 용량(API Pod 2·Pod 당 DB 연결 5)의 한계이고 수치 판정은 K-PaaS 부하 시험 몫이다. OpenAPI 429 는 D-51 |
| T-M4-37 Redis 장애 | ✅ | 현재 구현은 Redis 를 쓰지 않는다(멱등성=DB, 요청 한도=Pod 메모리). Redis 정지 중·재기동+FLUSHALL 뒤 작성·저장·결제·접수·Self-check 그대로, readiness 유지, 재시작 0 `tests/m4/results/redis-outage-kind-2026-09-29T17-16-19-213Z.json`. 지원자 세션을 Redis 에 두는 인증(M5) 때 다시 시험 |
| T-M4-42 대학 간 격리 | ✅ | 로컬 kind 2클러스터 축소 환경 통과. A 전면 정지 중 B 접수 2건·중앙 반영, A 복구 후 접수. `tests/m4/results/isolation-2026-09-27T16-42-39-057Z.json`. 인수기준의 "중앙 Dashboard 는 A대만 확인 불가" 를 뒷받침할 신호가 없었다 — 2026-09-30 §04 심장박동과 "내 원서" 대학별 `universityReachable` 을 붙였다(D-60, 시험은 CI 재현 DB). kind 에서 A 정지 중 표시 재확인 대기 |
| T-M4-33 동시 Finalize | ✅ | 100회 동시 요청 전부 성공(201×1, 200×99), Submission·Outbox·감사 각 1건. 로컬 축소 환경 |
| T-M4-34 PG 지연·UNKNOWN | ✅ | **PG 확정 1·5·15·30분 지연 실제 시간 통과**(2026-09-30, 로컬 축소 환경, Mock PG 지연 모드 `MOCK_PG_CONFIRM_DELAYS_S`). 지원자는 결제 직후 한 번 확인(UNKNOWN)하고 창을 닫는다. 8건 모두 사람 손 없이 접수 — 콜백 경로는 PG 확정 뒤 4.7~7.9초, 콜백이 끝내 오지 않는 폴링 경로는 49.9~171.3초(설계 Backoff 30초×2^n 안). FAILED·조기 확정·중복 접수 0, 늦은 콜백 재전송은 DUPLICATE·접수 1건 유지, 결제당 PG 조회 최대 7회 `tests/m4/results/pg-delay-realtime-2026-09-30T06-43-39-291Z.json`. **이 시험에서 리더 잠금 결함(D-54)을 찾아 고쳤다** — 수정 전에는 폴링 경로가 171.9초·533.9초로 늦었다(`…06-24-46-019Z.json`, 중단 실행). 시간 압축판(SLOW·UNKNOWN 복구)도 통과. PG p95 10초·5% timeout 의 부하 분포는 K-PaaS 부하 시험 몫 |
| T-M4-35 중앙 단절 | ✅ | **중앙 2시간 실제 단절 통과**(2026-09-30, 로컬 축소 환경) — 중앙을 120분 멈춘 채 5분마다 원서 24건(접수 18·접수 전 취소 6)을 모두 처리, 단계별 응답 최대 911ms. 120회 표본 내내 API Ready·자율 운영 모드, 가장 오래 기다린 이벤트 7,199초. Relay 재시도 횟수는 회로가 열린 뒤 4에서 멈춰 **DEAD 증가 0**. 중앙 복구 10초 뒤 24건 전량 SENT·중앙 수신 24/24(**event loss 0**)·접수는 "내 원서" 에, 취소는 중앙 요약 `CANCELLED` 로 반영, 17초 뒤 CONNECTED 복귀, Pod 재시작 0. 단절 중 대조가 `CENTRAL_ACK_MISSING`(HIGH) 13건을 올렸다 — 30분 넘게 ACK 가 없는 것을 잡는 설계대로의 신호다 — 복구 뒤 04:33 대조에서 13건 모두 AUTO_RESOLVED `tests/m4/results/central-outage-realtime-2026-09-30T01-59-27-784Z.json`. 앞서 8.8초 압축판도 통과 |
| T-M4-38 Object Storage 장애 | ✅ | 로컬 축소 환경에서 MinIO 완전 단절 중 카탈로그 20회 오류 0·원서 생성/자동저장 지속·직접 업로드만 실패. 복구 515ms 뒤 같은 단기 URL 업로드 200·서버 검증 202. `tests/m4/results/object-storage-outage-2026-09-28T06-14-19-725Z.json` |
| T-M4-39 API 종료 | 🟡 | 단일 노드: Pod 강제 삭제 283건·RollingUpdate 504건 연속 요청 오류 0. 다중 노드 kind(제어 1 + 워커 2, zone 2개) 재측정(2026-09-30, **부하는 kind 네트워크 안 컨테이너**): 계획 정비(drain) 0/666·정비 뒤 재분산 0/1,139 — 무중단. 노드 강제 정지는 첫 시도 6.1%·3번 재시도 뒤 사용자 체감 1.4%, 실패는 거의 다 NotReady(grace 16초 → 22초) 전 죽은 Pod 로 간 연결 시간 초과 — Edge 재시도(ADR-0008)가 흡수할 대상이라 K-PaaS 에서 판정. 대체 Pod 는 축출 10초 뒤 살아 있는 zone 에 Ready `node-failure-kind-2026-09-30T15-46-21-045Z.json`. 이 과정에서 고친 것: `nodeTaintsPolicy: Honor`·`matchLabelKeys`, 정비 뒤 재분산 절차(Honor 만 두면 정비 뒤 한 zone 에 모여 다음 장애가 전면 장애), PgBouncer 정상 종료(preStop·grace 60초)·앱 DB 풀 연결 사용 50회로 돌리기(rolling restart 체감 실패 2 → 0), 측정 도구 결함 둘(동기 kubectl·Docker Desktop 포트 전달 멈춤 — 이전 "약 10%·66초" 는 부풀려진 값). PgBouncer `trafficDistribution` 은 실측 뒤 기본에서 뺐다. 앞선 실행에서 DB 연결 시간 제한이 없어 노드 하나의 장애가 살아남은 Pod 까지 멈추던 결함도 고쳤다(D-52) |
| 나머지 | ⬜ | |

**로컬 축소 환경의 한계** — Docker Desktop 8GB 에서 이미지 빌드와 kind 클러스터 2개를 함께 돌리자 엔진이 멈췄다.
빌드와 클러스터는 따로 돌린다. 수치 시험(T-M4-30~32·36·41)은 K-PaaS 환경이 필요하다.

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

구현(ADR-0006): D-1 `scaleOutAt` 에 API 최소 replica 를 올리고(마감 1시간 전 단계를 앞당겨 포함),
`suspendJobsAt`(마감 6시간 전 권장)에 앱이 비핵심 작업을 멈추며, `endsAt` 에 되돌린다. Feature Freeze 는
관리자 콘솔의 마감 임박 Freeze(T-M3-02)가 맡는다. DB·Redis 는 클러스터 밖 HA 계층이라 이 예약이 바꾸지 않는다.

## 종료 체크리스트 — 노션 §08 Acceptance

- [ ] Read p95 ≤ 300ms
- [ ] Draft Save p95 ≤ 500ms
- [ ] Finalize 내부처리 p95 ≤ 1.5s (외부 PG 제외)
- [ ] 업무 Validation 제외 Error < 0.1%
- [ ] duplicate Submission 0 / Payment double-confirm 0
- [ ] Central event loss 0 / Sequence gap 미복구 0
- [ ] Central outage 중 핵심접수 지속
- [ ] DB failover 후 자동 복구
- [x] **대학 간 장애 격리 증명** (T-M4-42, 로컬 kind 2클러스터 축소 환경)
- [ ] **실측값으로 노션 v1.0 §10.1 Size Profile 보정** — 추정치를 실측으로 교체
- [ ] **노션 §08에 시나리오 13(대학 간 격리) 추가**
- [ ] Helm values 기본값을 실측 기준으로 조정하고 §05 첨부 갱신
- [ ] 발견한 불일치를 D-N으로 등록·처리 — M4 중 D-45~D-50 등록, D-47·D-49 는 노션 첨부 교체 대기
