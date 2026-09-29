# 인수인계 — 다음 작업자(사람·AI 공통)가 먼저 읽는 문서

> 작성: 2026-09-29 · 마지막 커밋 기준 `main`
> 이 저장소는 지금까지 한 AI 도구로 개발했다. 다른 도구(또는 사람)가 이어받을 때
> **도구 설정 파일에만 있던 규칙**과 **문서 여러 곳에 흩어진 다음 할 일**을 여기 한 장에 모았다.
> 세부는 링크를 따라간다. 이 문서와 다른 문서가 어긋나면 **다른 문서가 맞고, 이 문서를 고친다.**

---

## 1. 30초 요약

- **제품**: 원서로(K-Admission) — 대학 입학 원서접수를 대학별 Data Plane 으로 분산하는 플랫폼. 2026 GovTech 공모전 출품작
- **현재**: M0~M3 끝(MVP가 화면에서 접수번호까지 동작), **M4(분산 실증) 13/28 진행 중**. 전체 71/139 태스크
- **완료한 핵심 증명**: 로컬 kind 2클러스터 축소 환경에서 **대학 간 장애 격리 T-M4-42 통과**. A대 전면 정지 중 B대 접수·중앙 반영, A대 복구 후 접수까지 확인
- **최근 완료**: T-M4-07 Peak Mode 예약 → 서명 커밋 → Flux Pull 전환(ADR-0006, D-48 종결) · T-M4-20 전 서비스 계측·로그 상관관계 · T-M4-24 로그 마스킹 강제
- **바로 다음 할 일**: **T-M4-22 업무 KPI 지표(`finalize_success_rate`·`outbox_oldest_age_seconds`·`central_sync_lag_seconds` 등) → T-M4-21·23 대시보드** → [§4](#4-다음-작업--순서와-방법)

## 2. 반드시 지킬 규칙

| # | 규칙 | 근거 |
|---|---|---|
| R1 | **문서·커밋·보고는 한국어.** 코드 식별자·명령만 원문 | 저장소 전체가 한국어 |
| R2 | 커밋 메시지 형식: `feat: …` / `fix: …` / `docs: …` + 빈 줄 + `- ` 목록. **AI 공동저자(Co-Authored-By) 줄을 넣지 않는다** | `git log` 참고 |
| R3 | 브랜치: 지금까지 `main` 에 바로 커밋했다 (2인 팀 관행) | |
| R4 | **노션 기술설계서가 설계의 원본이다.** 설계와 다른 구현을 발견하면 조용히 고치지 말고 먼저 [불일치 대장](02-spec-discrepancy-register.md)에 `D-N` 으로 올린다 | [01-notion-sync-protocol.md](01-notion-sync-protocol.md) |
| R5 | **노션 첨부(DDL·OpenAPI·CloudEvents·Helm values 등)는 저장소 사본과 바이트가 같아야 한다.** 첨부 원본 파일(`deploy/charts/k-admission/values-m.yaml`, `deploy/platform/policies/*`, `tests/load/k6-admission.js`, `docs/spec-assets/*`)은 **고치지 않는다** — 다르게 해야 하면 대장에 올리고 차트·코드 쪽에서 다루거나, 노션 첨부를 교체한다. **계약 파일(DDL `0001_init.sql`·OpenAPI yaml·CloudEvents json)은 고칠 수 있지만, 고치면 같은 작업에서 노션 첨부도 다시 올린다**(지금까지 그렇게 했다) | [spec-assets/README.md](spec-assets/README.md) |
| R6 | **노션 페이지 수정은 페이지마다 사용자에게 확인받고 한다** | [05 문서 ③-7](05-m3-exit-m4-readiness.md) |
| R7 | 수치를 지어내지 않는다. 로컬(kind) 결과는 **"축소 환경"** 으로 명시하고, SLO·부하 수치는 K-PaaS 실측 전까지 "목표값" 이다 | [05 문서 ④](05-m3-exit-m4-readiness.md) |
| R8 | 흉내 구현(Mock PG·Mock AV·헤더 인증)은 **운영 모드(`NODE_ENV=production`)에서 기동이 막힌다.** 이 안전장치를 풀지 않는다 | [04-production-readiness.md](04-production-readiness.md) |
| R9 | 마감시각·전형료·전형 양식(Config) 버전은 **배포 값으로 넣지 않는다.** 관리자 콘솔의 2인 승인 → 서명된 활성화 기록으로만 바뀐다 | D-21 · D-35 · D-44 ⑥ |
| R10 | 새 지원자 API 경로는 소유권 검사(`this.ownership.assert…`)를 부른다. 빠뜨리면 `ownership-coverage.test.ts` 가 깨진다 | D-28 |

## 3. 환경 — 이 PC(Windows 11)에서 알아야 할 것

| 항목 | 내용 |
|---|---|
| 셸 | Git Bash 에서 `docker run -v/--tmpfs /tmp` 처럼 `/` 로 시작하는 인자는 경로 변환된다 → `export MSYS_NO_PATHCONV=1` |
| 도구 | kind 0.33 · Helm **4.3** · k6 2.2 · kubectl 1.34 (winget 설치). 새 터미널부터 PATH 에 잡힌다. 안 잡히면 `%LOCALAPPDATA%\Microsoft\WinGet\Packages\` 아래 `Helm.Helm_*\windows-amd64`, `Kubernetes.kind_*` 를 PATH 에 더한다. k6 는 `C:\Program Files\k6` |
| Docker | Desktop, VM 메모리 **약 7.5GB.** 이미지 빌드와 kind 클러스터 2개를 **동시에 돌리면 엔진이 멈춘다**(실제로 멈췄다). 빌드 → 클러스터 순서로, 하나씩 |
| 로컬 Flux 시험 | `E:\DockerData\gitops-test-20260929-1245` — bare `Wonseoro.git`·시험 사본 `work`(임시 SSH 서명키가 git 설정에 있음). kind-univ-a 의 Flux 리소스는 시험 뒤 suspend 상태. Git 서버는 `node tests/m4/helpers/git-smart-http-server.mjs <그 폴더> 9418` |
| 로컬 DB | compose: `postgres-univ-a` :5432 · `postgres-univ-b` :5442(`--profile multi`) · `postgres-central` :5434 · redis :6379 · minio :9000 |
| 테스트 | DB 가 있어야 통합 테스트까지 돈다 — 명령은 [03-next-steps.md 끝](03-next-steps.md#개발-환경-되살리기). admission-api 242 · server-kit 47 · central-api 20 · event-relay 5 (전체 314, DB 없는 실행 172 pass·142 skip·실패 0). 배포 스크립트 시험은 `npm run test:m4:gitops`(Peak 예약 9건 포함). **DB 통합 시험 전에 kind univ-a 의 API·Relay 를 0 으로 줄인다** — 같은 로컬 `univ_a` DB 를 봐서 시험 행을 먼저 집어 간다(결제 재확인·Relay 시험이 실패하거나 멈춘다). event-relay 시험은 직렬로 돈다 |
| 검사 | `npm run db:verify`(DB 제약 20종) · `node scripts/check-deps.mjs`(의존성 선언) · `helm lint deploy/charts/k-admission` |

## 4. 다음 작업 — 순서와 방법

원본은 [03-next-steps.md「다음 개발 목표」](03-next-steps.md#다음-개발-목표-2026-09-29-설정)와 [M4 마일스톤](milestones/M4-federated-proof.md). 아래는 **실행 방법**까지 붙인 요약이다.

### 목표 1 — 대학 간 장애 격리 증명 (T-M4-42) ✅ 완료

**결과** — `tests/m4/results/isolation-2026-09-27T16-42-39-057Z.json` (로컬 축소 환경)

```bash
docker ps -a                                  # 무엇이 살아 있는지부터
kind get clusters                             # univ-a, univ-b 가 남아 있는지
```

- 클러스터가 없거나 이상하면 `kind delete cluster --name univ-a` 후 README 절차로 다시 만든다
- 이미지 4종(`k-admission/{admission-api,event-relay,document-service,central-api}:dev`)은 **클러스터를 띄우기 전에** 빌드한다.
- `kind load docker-image … --name univ-a` → `helm upgrade --install`(README 명령) → 세 Deployment 가 Ready 인지 확인
- 중앙 API 는 클러스터 밖 컨테이너 `ka-central`(:3000). 없으면 README 명령으로 띄운다
- `univ_b` DB 와 중앙 `university_registry` 의 `UNIV-B` 는 이미 만들어 두었다(볼륨이 남아 있으면 그대로)

**NetworkPolicy 결과** — kindnet이 정책을 실제 집행한다. 양 대학 모두 자기 DB·Redis·중앙·MinIO는 연결되고, 다른 대학 DB·임의 외부·Worker→중앙은 timeout, Worker→자기 API는 연결된다. 공통 values가 양쪽 DB 포트를 열던 문제는 D-45로 수정했다.

**재실행**

```bash
node tests/m4/isolation.mjs
```

A 클러스터 노드 컨테이너를 멈춘 동안 B 대학의 원서 생성→저장→결제→자동 접수, 중앙 "내 원서" 반영, A 복구 후 A 접수까지 확인한다. 첫 실행은 중앙이 현재 `subjectRef` 형식을 버리는 D-46을 발견했고, 수정 후 재실행해 통과했다.

**남은 기록** — 노션 §08에 **시나리오 13(대학 간 격리)** 추가(R6: 사용자 확인 후)

### 목표 2 — 로컬 기능 시험 (kind 위에서, 축소 환경)

| ID | 방법 |
|---|---|
| T-M4-33 | 결제 확인된 원서 하나에 `POST /finalize` 100회 동시 → `submission` 1건 (k6 또는 Node 스크립트) |
| T-M4-34 | Mock PG 동작 `SLOW`·`UNKNOWN`(거래번호에 포함하거나 `MOCK_PG_BEHAVIOUR`) + `PAYMENT_RECHECK_INTERVAL_MS` 를 줄여 콜백 지연을 시간 압축 → 자동 정합화·이중 확정 0 |
| T-M4-35 | `docker stop ka-central` 동안 접수 지속 → 재시작 후 Outbox 재전송·event loss 0 (2시간 → 축소, 결과에 명시) |
| T-M4-39 | `kubectl delete pod` / 노드 재시작 중 요청 → PDB·`maxUnavailable: 0` 으로 무중단 |

### 목표 3 — 차트에 남은 운영 기능

T-M4-09 PgBouncer는 두 kind 클러스터에 배포했고 직접 DB 우회 차단·동시 30쿼리·upstream 최대 10/10을 확인했다.
결과는 `tests/m4/results/pgbouncer-2026-09-28T01-26-13-047Z.json`. T-M4-07은 완료했다(ADR-0006). 대학별
`peak-schedule.yaml` 을 예약 워크플로(`.github/workflows/peak-mode.yml`)가 10분마다 `peak-mode.yaml` overlay 로 계산해
바뀐 경우만 서명 커밋하고, Flux 가 Pull 해 API 최소 replica 를 올리고 내린다. 앱은 억제~종료 시각에만 자동 대조를 멈춘다.
로컬 kind 에서 2→3(push 뒤 62초)·원복(33초)을 확인했다 — `tests/m4/results/peak-mode-gitops-2026-09-29T11-43-36-484Z.json`,
재실행 절차는 `deploy/gitops/local/README.md`. 첨부 values-m 예시 시각이 영구 억제를 만드는 문제는 D-49(노션 첨부 교체 대기). 예약 워크플로는 저장소 변수 `PEAK_MODE_ENABLED=true` 일 때만 러너를 띄운다(opt-in).

T-M4-20·T-M4-24는 완료했다. 계측은 `packages/server-kit` 에 모였다 — `telemetry-sdk`(SDK 진입점, **index 로 내보내지 않는다**:
index 를 거치면 `pg` 가 먼저 로드돼 DB span 이 빠진다), `telemetry/http`(HTTP 지표·span), `telemetry/trace`(traceparent 전파·
`withSpan`), `telemetry/logger`(한 줄 JSON·trace_id·마스킹). 네 서비스의 `src/instrumentation.ts` 가 main 의 첫 import 로
SDK 를 켜고 전역 Nest 로거를 바꾼다. `scripts/check-logging.mjs` 가 CI 에서 console 직접 출력·로거 누락을 막는다.
kind A 에 Flux(서명 병합 → Pull)로 새 이미지를 배포해 세 워크로드 수집 up=1·구조화 로그를 확인했다 —
`tests/m4/results/telemetry-kind-2026-09-29T14-05-37-946Z.json`. B 와 클러스터 밖 `ka-central` 은 아직 이전 이미지다.
**Flux 가 소유한 release 는 `helm upgrade` CLI 로 바꿀 수 없다**(server-side apply 충돌) — 시험 사본에 서명 병합 → bare 로 push → Flux 재개.

다음은 T-M4-22 업무 KPI 지표 → T-M4-21·23 대시보드다. 각 인수기준은 [M4 마일스톤](milestones/M4-federated-proof.md).

T-M4-08은 A kind에 Prometheus `29.35.0`·Adapter `5.3.0`을 설치하고 RPS·p95 지연·처리 중 요청 수를
Custom Metrics API와 HPA에서 모두 확인해 완료했다. 설정은 `deploy/platform/observability/`, 결과는
`tests/m4/results/hpa-custom-metrics-2026-09-29T03-27-10-000Z.json`이다. 로컬에는 metrics-server가 없어 CPU 지표는
`<unknown>`이었고 DB 연결 예산 때문에 maxReplica만 4로 낮춰 시험했으며, 시험 뒤 로컬 HPA는 다시 껐다.

Docker/kind 노드 강제 종료에서 PgBouncer의 `/tmp/pgbouncer.pid`가 `emptyDir`에 남아 재기동을 막는 문제도 수정했다.
진입점이 새 컨테이너 기동 직전에 stale PID 파일을 제거한다. 수정 이미지를 A/B에 배포한 뒤 A 노드를 강제 재시작했고,
PgBouncer가 같은 Pod에서 오류 없이 재기동하여 A의 앱 전체와 관측 스택이 Ready로 복구되는 동안 B는 계속 정상임을 확인했다.

T-M4-05는 Flux 2.9.5를 대학 클러스터 내부 Pull 실행 주체로 채택했다(ADR-0005). 운영 bootstrap은 `main` HEAD의
SSH/PGP 서명을 검증하며 HelmRelease는 `kadmission-app` 전용 `release-controller`로만 수렴한다. 로컬 A kind에서
signed HEAD의 SourceVerified·Helm v25 적용, unsigned HEAD의 `InvalidCommitSignature` 거부와 last-good 유지,
replica drift 1→2 자동 복구를 확인했다. 결과는 `tests/m4/results/gitops-pull-2026-09-29T04-24-15-000Z.json`.
시험용 Flux 리소스는 성공 상태에서 suspend했고 앱은 Ready로 유지했다. 이미지 Cosign admission 검증은 실제 Registry·신뢰키가 필요한 M5 공급망 게이트다.

T-M4-38은 로컬 축소 환경에서 MinIO 완전 단절 중 카탈로그 20회·원서 생성·자동저장이 정상이고 직접 업로드만 실패하는 것을 확인했다.
MinIO 복구 515ms 뒤 기존 단기 URL 업로드와 서버 검증까지 통과했다. 결과는
`tests/m4/results/object-storage-outage-2026-09-28T06-14-19-725Z.json`.

Docker 데이터는 `E:\DockerData\DockerDesktopWSL`로 이전되어 C: 여유 공간이 약 22GB로 회복됐다.
Docker Desktop AI Inference 엔진은 이 프로젝트에서 쓰지 않으며, stale `dockerInference` 소켓으로 재기동이 충돌해
`settings-store.json` 의 `EnableDockerAI=false`로 비활성화했다. 이전 공간 부족 때 B kind의 Node 이미지 레이어가
손상되어 B 클러스터만 재생성했다. 대학 DB는 외부 Docker volume이라 데이터 손실은 없다.

### 목표 4 — 노션 반영 (R6)

- §05 첨부 runtime·values-m 교체 — D-44 ①~⑦ (포트·프로브·NODE_ENV·대조 방식·마감버전 제거·**커넥션 예산 초과**)
- §07 와이어프레임 결제 화면 문구 — D-43
- §05 첨부 values-m `peakMode.scheduledActivation` 예시 시각 비우기 — D-49 (D-44 교체와 함께)

첨부 교체 방법: 노션 MCP 의 file upload 로 저장소 파일을 **그대로** 올리고(바이트 수 확인) 페이지의 file 블록을 바꾼다.
노션 첨부를 **내려받는** 것은 MCP 로 안 된다 — 로그인된 브라우저에서 `/api/v3/getSignedFileUrls` (절차: 대장 D-5).

## 5. 사람이 해야 하는 것 (AI 가 대신 못 함)

| 항목 | 상태 |
|---|---|
| K-PaaS(또는 클라우드) 시험 환경 | 3,000 CCU·1,000 RPS·6시간 Soak·DB Failover 실측(T-M4-30~32·36·41)에 필요. 없음 |
| 제출 PDF 정정 (D-2·D-3) | 개발보고서의 "Java/Spring" 표기 → NestJS·TypeScript |
| values-m 커넥션 수치 (D-44 ⑦) | Pod 당 40 → 38 로 줄일지, 예산 400 → 411 이상으로 올릴지 |
| Peak Mode 예약 워크플로 켜기 | GitHub environment `peak-mode` + secret `PEAK_MODE_SSH_SIGNING_KEY`, 저장소 변수 `PEAK_MODE_ENABLED=true`, 대학 `wonseoro-git-authors` 에 예약 자동화 공개키 추가 (ADR-0006) |
| 노션 페이지 수정 승인 | R6 |

## 6. 전체 남은 규모

139개 중 71개 완료, **68개 남음**.
AI 가 이 PC 에서 할 수 있는 것 약 41개, 외부 환경 필요 약 15개, 사람·기관 필요 약 15개.

## 7. 어디에 무엇이 있나

| 찾는 것 | 위치 |
|---|---|
| 지금 할 일 | [03-next-steps.md](03-next-steps.md) |
| 단계별 태스크·인수기준 | [milestones/](milestones/) |
| 설계와 구현이 다른 곳 49건 | [02-spec-discrepancy-register.md](02-spec-discrepancy-register.md) |
| 노션 문서 지도·동기화 규칙 | [01-notion-sync-protocol.md](01-notion-sync-protocol.md) |
| 왜 이렇게 정했나 | [adr/](adr/) — 최신 ADR-0006 Peak Mode 예약 GitOps |
| 배포 | `deploy/` — 차트 `charts/k-admission`, 대학별 `universities/`, 로컬 `local/` |
| API 계약 | `packages/contracts/openapi/k-admission.v1.yaml` (v1.2.0) — 컨트롤러와 다르면 계약 적합성 시험이 깨진다 |
| DB 스키마 | `infra/db/migrations/0001_init.sql`(= 노션 §02 첨부 v1.2) · `0002_db_roles.sql` |
