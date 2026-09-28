# 인수인계 — 다음 작업자(사람·AI 공통)가 먼저 읽는 문서

> 작성: 2026-09-28 · 마지막 커밋 기준 `main`
> 이 저장소는 지금까지 한 AI 도구로 개발했다. 다른 도구(또는 사람)가 이어받을 때
> **도구 설정 파일에만 있던 규칙**과 **문서 여러 곳에 흩어진 다음 할 일**을 여기 한 장에 모았다.
> 세부는 링크를 따라간다. 이 문서와 다른 문서가 어긋나면 **다른 문서가 맞고, 이 문서를 고친다.**

---

## 1. 30초 요약

- **제품**: 원서로(K-Admission) — 대학 입학 원서접수를 대학별 Data Plane 으로 분산하는 플랫폼. 2026 GovTech 공모전 출품작
- **현재**: M0~M3 끝(MVP가 화면에서 접수번호까지 동작), **M4(분산 실증) 8/28 진행 중**. 전체 66/139 태스크
- **완료한 핵심 증명**: 로컬 kind 2클러스터 축소 환경에서 **대학 간 장애 격리 T-M4-42 통과**. A대 전면 정지 중 B대 접수·중앙 반영, A대 복구 후 접수까지 확인
- **바로 다음 할 일**: **T-M4-05 GitOps Pull 실행 주체 확정·T-M4-07 예약 HPA 전환 연결** → [§4](#4-다음-작업--순서와-방법)

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
| 로컬 DB | compose: `postgres-univ-a` :5432 · `postgres-univ-b` :5442(`--profile multi`) · `postgres-central` :5434 · redis :6379 · minio :9000 |
| 테스트 | DB 가 있어야 통합 테스트까지 돈다 — 명령은 [03-next-steps.md 끝](03-next-steps.md#개발-환경-되살리기). admission-api 234 · server-kit 35 · central-api 20 · event-relay 4 (실패 0, 3개는 관리자 토큰 설정 여부로 건너뜀) |
| 검사 | `npm run db:verify`(DB 제약 20종) · `node scripts/check-deps.mjs`(의존성 선언) · `helm lint deploy/charts/k-admission` |

## 4. 다음 작업 — 순서와 방법

원본은 [03-next-steps.md「다음 개발 목표」](03-next-steps.md#다음-개발-목표-2026-09-28-설정)와 [M4 마일스톤](milestones/M4-federated-proof.md). 아래는 **실행 방법**까지 붙인 요약이다.

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
결과는 `tests/m4/results/pgbouncer-2026-09-28T01-26-13-047Z.json`. T-M4-07은 즉시 최소 replica 상향과 예약 시각 이후
비핵심 자동 대조 억제까지 반영했다(시험 5건·Helm 렌더링 통과). 예약 시각에 HPA를 바꿀 실행 주체가 없던 공백은 D-48로 기록했으며,
애플리케이션에 Kubernetes 수정 권한을 주지 않고 T-M4-05 GitOps Pull과 함께 해결한다. 그 다음은 T-M4-08 HPA 커스텀 지표(metrics adapter) ·
T-M4-20~24 관측성 순서다. 각 인수기준은 [M4 마일스톤](milestones/M4-federated-proof.md).

T-M4-38은 로컬 축소 환경에서 MinIO 완전 단절 중 카탈로그 20회·원서 생성·자동저장이 정상이고 직접 업로드만 실패하는 것을 확인했다.
MinIO 복구 515ms 뒤 기존 단기 URL 업로드와 서버 검증까지 통과했다. 결과는
`tests/m4/results/object-storage-outage-2026-09-28T06-14-19-725Z.json`.

Docker 데이터는 `E:\DockerData`로 이전되어 C: 여유 공간이 약 25GB로 회복됐다. 이전 공간 부족 때 B kind의
Node 이미지 레이어가 손상되어 B 클러스터만 재생성했다. 대학 DB는 외부 Docker volume이라 데이터 손실은 없다.

### 목표 4 — 노션 반영 (R6)

- §05 첨부 runtime·values-m 교체 — D-44 ①~⑦ (포트·프로브·NODE_ENV·대조 방식·마감버전 제거·**커넥션 예산 초과**)
- §07 와이어프레임 결제 화면 문구 — D-43

첨부 교체 방법: 노션 MCP 의 file upload 로 저장소 파일을 **그대로** 올리고(바이트 수 확인) 페이지의 file 블록을 바꾼다.
노션 첨부를 **내려받는** 것은 MCP 로 안 된다 — 로그인된 브라우저에서 `/api/v3/getSignedFileUrls` (절차: 대장 D-5).

## 5. 사람이 해야 하는 것 (AI 가 대신 못 함)

| 항목 | 상태 |
|---|---|
| K-PaaS(또는 클라우드) 시험 환경 | 3,000 CCU·1,000 RPS·6시간 Soak·DB Failover 실측(T-M4-30~32·36·41)에 필요. 없음 |
| 제출 PDF 정정 (D-2·D-3) | 개발보고서의 "Java/Spring" 표기 → NestJS·TypeScript |
| values-m 커넥션 수치 (D-44 ⑦) | Pod 당 40 → 38 로 줄일지, 예산 400 → 411 이상으로 올릴지 |
| 노션 페이지 수정 승인 | R6 |

## 6. 전체 남은 규모

139개 중 66개 완료, **73개 남음**.
AI 가 이 PC 에서 할 수 있는 것 약 44개, 외부 환경 필요 약 15개, 사람·기관 필요 약 15개.

## 7. 어디에 무엇이 있나

| 찾는 것 | 위치 |
|---|---|
| 지금 할 일 | [03-next-steps.md](03-next-steps.md) |
| 단계별 태스크·인수기준 | [milestones/](milestones/) |
| 설계와 구현이 다른 곳 47건 | [02-spec-discrepancy-register.md](02-spec-discrepancy-register.md) |
| 노션 문서 지도·동기화 규칙 | [01-notion-sync-protocol.md](01-notion-sync-protocol.md) |
| 왜 이렇게 정했나 | [adr/](adr/) |
| 배포 | `deploy/` — 차트 `charts/k-admission`, 대학별 `universities/`, 로컬 `local/` |
| API 계약 | `packages/contracts/openapi/k-admission.v1.yaml` (v1.2.0) — 컨트롤러와 다르면 계약 적합성 시험이 깨진다 |
| DB 스키마 | `infra/db/migrations/0001_init.sql`(= 노션 §02 첨부 v1.2) · `0002_db_roles.sql` |
