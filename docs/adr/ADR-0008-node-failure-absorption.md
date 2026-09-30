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
   zone 을 강제로 나눈다. Kubernetes 1.26+ 가 필요하다. zone 을 3개 둘 수 있으면 둔다(한 zone 장애에도 두 zone 에 분산 유지).
2. **노드 장애 판정 시간은 대학 SLO 에 맞춰 줄인다** — K-PaaS 제어 평면 설정(`node-monitor-grace-period`)과 kubelet
   `nodeStatusUpdateFrequency`. 기준: grace 는 상태 보고 주기의 4배 이상(오탐 방지). 로컬 비교 수치는 아래 「측정」.
   관리형 제어 평면이라 바꿀 수 없으면 3번이 그 구간을 전부 떠안는다.
3. **Edge 재시도는 필수 플랫폼 요구사항이다.** 연결 실패·연결 시간 초과(연결 2초)면 다른 엔드포인트로 **1회** 재시도한다.
   POST/PATCH 도 포함한다 — 모든 변경 요청이 Idempotency-Key 를 요구하고 서버가 같은 키를 한 번만 처리하므로
   재시도가 중복 접수·중복 결제가 되지 않는다. 응답을 받은 뒤의 5xx 는 재시도하지 않는다(503 은 `Retry-After` 로 화면이 다룬다).
4. **Edge 구현은 Gateway API 를 지원하는 유지보수 중인 컨트롤러로 한다.** §06 첨부·차트 NetworkPolicy 가 가정한
   ingress-nginx 는 상위 프로젝트가 2026년 3월 은퇴해 보안 패치가 없다(D-53). 차트는 Edge 선택자를 values
   (`networkPolicy.ingressFrom`)로 받으므로 코드 변경 없이 바꿀 수 있다.
5. PgBouncer sidecar(노드 간 DB 경로 제거)는 K-PaaS 부하 시험 때 커넥션 수와 함께 비교한다 — 지금은 결정하지 않는다.

## 측정 (로컬 축소 환경, kind 제어 1 + 워커 2, zone 2개)

이전 측정(기본 판정 시간, nodeTaintsPolicy 기본값): 계획 정비(drain) 요청 879건 실패 0. 노드 강제 정지 때 NotReady 판정 49초, 정지 1.5초 뒤부터 66.6초까지 요청의 약 10%(1,681건 중 160건)가 2초 안에 응답받지 못함(D-52).

**재측정 대기** — `kind-univ-a-multinode-tuned.yaml`(grace 16초) + `nodeTaintsPolicy: Honor` 로 끊김 구간과 대체 Pod 배치를 다시 잰다. 결과가 나오면 여기에 채운다.

## 결과

- 좋은 점: 분산 규칙이 장애 중 복구를 막지 않는다. 노드 장애 구간이 판정 시간만큼 줄고, 남은 구간은 멱등 재시도로 흡수된다.
- 나쁜 점: 판정 시간을 줄이면 짧은 네트워크 흔들림에도 Pod 가 엔드포인트에서 빠질 수 있다. Edge 재시도는 실패한 첫 시도만큼
  지연을 더한다(연결 시간 초과 2초).
- 운영: K-PaaS 착수 때 제어 평면 설정 가능 여부·Gateway 컨트롤러·zone 수를 확인하고 §08 시나리오 10 을 실측한다.
