# ADR-0008 — 노드 장애 흡수: zone 분산 nodeTaintsPolicy·노드 판정 시간·Edge 재시도

- 상태: 채택 (Edge 구현 선택은 K-PaaS 환경에서 확정)
- 날짜: 2026-09-30
- 관련: T-M4-39, D-52, D-53, 기술설계서 v1.1 §05·§06·§08 시나리오 10

## 맥락

§08 시나리오 10 은 "API Node 강제 종료" 에서 무중단을 요구한다. 차트는 API·PgBouncer 2개 이상, zone 분산(`DoNotSchedule`),
PDB, `maxUnavailable: 0`, preStop 을 갖췄고 계획 정비(drain)는 무중단이었다. 그러나 노드가 **예고 없이** 죽으면
쿠버네티스가 그 노드를 NotReady 로 판정할 때까지 Service 가 죽은 Pod 로 요청을 계속 보낸다. 로컬 축소 환경에서
그 구간(약 50초 + 반영)에 요청의 약 10% 가 실패했다(D-52). 앱이 할 수 있는 것 — 매달린 DB 연결을 10초 안에 버리고
503 으로 재시도를 안내 — 은 이미 했다. 남은 것은 플랫폼의 세 가지 설정이고, 이 ADR 이 기본값을 정한다.

또 하나: 차트·§06 첨부의 zone 분산은 `whenUnsatisfiable: DoNotSchedule`, `maxSkew: 1` 이다. 기본 `nodeTaintsPolicy`(Ignore)는
장애로 taint 된 노드도 분산 계산에 넣는다. zone 이 2개일 때 한 zone 이 죽어 그 zone 의 Pod 가 축출되면, 죽은 zone 은
"Pod 0개인 도메인" 으로 남고 대체 Pod 를 살아 있는 zone 에 두면 skew 가 2 가 되어 **대체 Pod 가 Pending** 으로 남는다.
장애를 버티려고 넣은 분산 규칙이 장애 중 복구를 막는다.

## 결정

1. **zone 분산에 `nodeTaintsPolicy: Honor`** (차트 기본값, values-m v1.2). NotReady·unreachable taint 가 붙은 노드를 분산
   계산에서 빼므로 zone 이 2개여도 대체 Pod 가 살아 있는 zone 에 놓인다. `DoNotSchedule` 은 유지한다 — 평시에는 여전히
   zone 을 강제로 나눈다. Kubernetes 1.26+ 가 필요하다. 참고로 zone 을 3개로 늘려도 기본값(Ignore)의 문제는 풀리지 않는다 —
   (1,1,1) 에서 한 zone 이 빠지면 (1,1,0) 이고 대체 Pod 를 어디에 두든 skew 가 2 가 된다. HPA 확장 Pod 도 같은 이유로 막힌다.
   - **대가 (실측)**: drain 으로 cordon 된 노드도 taint 가 붙어 분산 계산에서 빠진다. 정비 동안 API·PgBouncer 가 **한 zone 에
     모이고, uncordon 뒤 저절로 다시 나뉘지 않는다.** 그대로 두면 다음 노드 장애가 전체 장애다 — 로컬에서 API 2개·PgBouncer 2개가
     모두 한 노드에 남은 채 그 노드를 멈추자 살아 있는 API 가 없었고, 대체 API 는 PgBouncer 가 없어 Ready 가 되지 못해 노드가 돌아올
     때까지 전면 장애였다(\`node-failure-kind-2026-09-30T07-19-40-000Z.json\` — 호스트 경로 측정이라 건수는 참고만).
   - 그래서 **정비 절차에 재분산을 넣는다**: uncordon 뒤 `rollout restart`(API·PgBouncer). 운영은 descheduler 의
     `RemovePodsViolatingTopologySpreadConstraint` 로 자동화한다. 로컬 실측에서 재분산 중 사용자 체감 실패 0.
   - **`matchLabelKeys: [pod-template-hash]`** 를 함께 둔다. 없으면 rollout 중 옛 Pod 가 세어져, 2 replica 에서 교체가 끝난 뒤
     새 Pod 두 개가 한 zone 에 몰린다(실측). 있으면 새 버전 Pod 끼리 분산을 센다. Kubernetes 1.27+.
2. **노드 장애 판정 시간은 대학 SLO 에 맞춰 줄인다** — K-PaaS 제어 평면 설정(`node-monitor-grace-period`)과 kubelet
   `nodeStatusUpdateFrequency`. 기준: grace 는 상태 보고 주기의 4배 이상(오탐 방지). 로컬 비교 수치는 아래 「측정」.
   관리형 제어 평면이라 바꿀 수 없으면 3번이 그 구간을 전부 떠안는다.
3. **Edge 재시도는 필수 플랫폼 요구사항이다.** 연결 실패·연결 시간 초과(연결 2초)면 다른 엔드포인트로 **1회** 재시도한다.
   POST/PATCH 도 포함한다 — 모든 변경 요청이 Idempotency-Key 를 요구하고 서버가 같은 키를 한 번만 처리하므로
   재시도가 중복 접수·중복 결제가 되지 않는다. 응답을 받은 뒤의 5xx 는 재시도하지 않는다(503 은 `Retry-After` 로 화면이 다룬다).
4. **Edge 구현은 Gateway API 를 지원하는 유지보수 중인 컨트롤러로 한다.** §06 첨부·차트 NetworkPolicy 가 가정한
   ingress-nginx 는 상위 프로젝트가 2026년 3월 은퇴해 보안 패치가 없다(D-53). 차트는 Edge 선택자를 values
   (`networkPolicy.ingressFrom`)로 받으므로 코드 변경 없이 바꿀 수 있다.
5. **PgBouncer 는 정상 종료한다.** preStop 10초(엔드포인트에서 빠지는 동안 새 연결도 받는다) → SIGTERM(새 연결 거절, 기존 클라이언트가
   떠나기를 기다림) → grace 60초. 앱 DB 풀은 **연결을 사용 50회(`maxUses`)·idle 10초로 돌려**, 종료 중인 PgBouncer 의 연결이 바쁠 때도 한가할 때도 저절로
   다른 PgBouncer 로 옮겨 간다. 이게 없으면 바쁜 풀이 연결을 영영 놓지 않아 grace 끝의 SIGKILL 이 쓰던 연결을 끊는다 — 로컬에서
   PgBouncer rolling restart 중 첫 시도 실패 40건·사용자 체감 2건이던 것이 0 이 됐다.
   - **연결 돌리기는 시간이 아니라 사용 횟수로 한다.** 처음에는 pg-pool `maxLifetimeSeconds`(30초)로 했는데, 켜자 DB 통합 시험 여럿이
     3초 획득 시한·정확히 30초 시간 초과로 실패했다 — 풀 대기열이 누군가의 수명 타이머가 돌 때까지 깨어나지 않았다(끄면 전부 통과).
     `maxUses`(50) 는 오류 난 연결을 버리는 것과 같은 경로라 시험이 전부 통과했다.
6. **PgBouncer Service 의 `trafficDistribution`(PreferSameZone)은 쓰지 않는다.** 같은 zone 의 PgBouncer 로 보내면 노드 장애 때 다른 zone 의
   API 가 죽은 PgBouncer 연결에 묶이지 않으리라 봤지만, 클러스터 안 부하로 비교하니 노드 장애 이득은 작고(첫 시도 실패 6.9% → 5.7%)
   rolling restart 중 사용자 체감 실패가 0 → 10건으로 늘었다. 차트에 선택 사항으로만 둔다(기본 끔).
7. PgBouncer sidecar(노드 간 DB 경로 제거)는 K-PaaS 부하 시험 때 커넥션 수와 함께 비교한다 — 지금은 결정하지 않는다.

## 측정 (로컬 축소 환경, kind 제어 1 + 워커 2, zone 2개)

**기준 결과** — `kind-univ-a-multinode-tuned.yaml`(grace 16초·상태 보고 4초), 차트 기본값(Honor·matchLabelKeys·PgBouncer 정상 종료·연결 사용 50회),
지원자 20명(1초마다 조회, 3초마다 자동저장, 같은 멱등키로 1초 간격 최대 3번), **부하는 kind Docker 네트워크 안의 컨테이너** 에서.
`tests/m4/results/node-failure-kind-2026-09-30T15-46-21-045Z.json` (연결 수명 30초로 돌리던 판 `…15-10-18-193Z.json` 도 같은 수준)

| 단계 | 요청 | 첫 시도 실패 | 사용자 체감 실패(3번 모두) | 비고 |
|---|---|---|---|---|
| 평시 | 401 | 0 | 0 | |
| 계획 정비(drain) | 666 | 0 | 0 | |
| 정비 뒤 재분산(API·PgBouncer rollout restart) | 1,139 | 0 | 0 | 두 zone 으로 다시 나뉨 |
| 노드 강제 정지 | 2,759 | 167 (6.1%) | 38 (1.4%) | NotReady(22초) 전 25초에 138건이 몰림, 151건이 죽은 Pod 로 간 연결 시간 초과. 그 뒤 65~125초에 구간당 2~9건 — 원인 미확인 |
| 노드 복구 | 405 | 3 | 0 | |

대체 API Pod 는 죽은 노드의 Pod 를 축출하고 10초 뒤 살아 있는 zone 에 Ready 였다(Honor). 노드 판정은 grace 16초에서 21~36초에 났다
(기본값 49초). 남은 실패는 **연결 단계의 시간 초과**라 결정 3(Edge 가 다른 엔드포인트로 재시도)이 그대로 흡수할 대상이다 — 이 로컬 환경에는
Edge 가 없어 요청이 NodePort(kube-proxy 무작위 선택)로 바로 가므로 재시도가 다시 죽은 Pod 로 갈 수 있다(3번 모두 실패 = 체감 실패).

**측정 도구에서 나온 것 — 이전 수치는 쓰지 않는다.** D-52 처음 수치(약 10%·66초)와 이날 앞선 실행들은 두 가지로 부풀려졌다.
① 시험 스크립트가 부하 중에 `kubectl` 을 동기(`execFileSync`)로 불러 자기 이벤트 루프를 멈췄고, 그 사이 요청 20개의 2초 타이머가 한꺼번에
끝나 "전원 timeout" 으로 셌다(서버에는 오류가 없었다). ② Windows 호스트 → Docker Desktop 포트 전달(localhost:18082)이 노드 컨테이너를
멈출 때 50초 넘게 막혔다 — 같은 시각 제어 노드 안 NodePort·Pod 네트워크·살아남은 Pod(DB 포함)는 모두 정상이었다(구간별 측정
`…14-34-16-996Z.json`, Pod 자기 점검 `…14-26-42-724Z.json`, DB 세션 표본 `…14-18-01-537Z.json`). 그래서 kubectl·docker 를 모두 비동기로 부르고
이벤트 루프 지연을 함께 재며(최대 114ms), 부하는 kind 네트워크 안 컨테이너(`tests/m4/helpers/load-users.mjs`)가 만든다.

## 결과

- 좋은 점: 분산 규칙이 장애 중 복구를 막지 않는다. 계획 정비·재분산·PgBouncer 교체가 사용자에게 보이지 않는다. 노드 장애 구간이
  판정 시간만큼 줄고, 남은 연결 시간 초과는 멱등 재시도로 흡수된다.
- 나쁜 점: 판정 시간을 줄이면 짧은 네트워크 흔들림에도 Pod 가 엔드포인트에서 빠질 수 있다. Edge 재시도는 실패한 첫 시도만큼
  지연을 더한다(연결 시간 초과 2초).
- 운영: 정비 절차에 "uncordon 뒤 재분산" 을 넣는다(descheduler 권장). K-PaaS 착수 때 제어 평면 설정 가능 여부·Gateway 컨트롤러(재시도 설정)·
  zone 수를 확인하고 §08 시나리오 10 을 Edge 를 거친 부하로 실측한다 — 인수기준 "사용자 체감 실패 0" 은 그때 판정한다.
