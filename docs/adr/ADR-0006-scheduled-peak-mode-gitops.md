# ADR-0006 — Peak Mode 예약을 서명된 Git desired state 전환으로 실행

- 상태: 채택
- 날짜: 2026-09-29
- 관련: T-M4-07, D-48, D-49, ADR-0005, 기술설계서 §01 B1·C4, v1.1 §05 첨부 `values-m.yaml`

## 맥락

§01 B1은 "HPA 반응을 기다리면 이미 늦다"며 D-1 사전 확장, 마감 전 최소 replica 상향, 비핵심 작업 억제를
요구한다. 첨부 `values-m.yaml`은 `peakMode.scheduledActivation` 하나로 이것을 표현하지만, 시각을 읽어
Kubernetes 상태를 바꿀 실행 주체는 없었다(D-48). ADR-0005로 대학 클러스터의 배포 주체는 Flux Pull로 정해졌고,
애플리케이션 Pod에는 Kubernetes 수정 권한을 주지 않는다. Flux에는 시각 기반 values 전환 기능이 없다.

선택지:

| 안 | 내용 | 판정 |
|---|---|---|
| A | 클러스터 안 CronJob이 HPA를 patch | ✖ Flux drift 복구가 되돌린다. 클러스터 안에 쓰기 권한 주체가 하나 더 생긴다 |
| B | 앱이 예약 시각에 스스로 확장 | ✖ 앱에 Kubernetes 권한을 주게 된다 (D-48 판정 위반) |
| C | 예약 시각에 **Git desired state를 서명 커밋으로 바꾼다** — Flux가 평소처럼 Pull | ✔ 신뢰 경계가 ADR-0005 그대로다. 모든 전환이 Git 이력·서명으로 남는다 |

## 결정

**C를 채택한다.**

1. 대학별 `deploy/universities/<UNIV>/peak-schedule.yaml`에 예약 창을 적는다 — `scaleOutAt`(사전 확장)·
   `suspendJobsAt`(비핵심 작업 억제)·`endsAt`(원복)·선택 `apiMinReplicas`. **용량 예약이지 마감시각이 아니다.**
   마감 판정은 관리자 콘솔 2인 승인·서명된 활성화 기록으로만 바뀐다(R9).
2. `scripts/peak-mode-sync.mjs`가 예약과 현재 시각에서 `peak-mode.yaml` overlay를 결정적으로 만든다.
   시작은 `leadMinutes`(기본 60분)만큼 앞당기고, 종료는 앞당기지 않는다. 같은 계획이면 같은 바이트라서
   예약이 그대로면 커밋이 생기지 않는다.
3. HelmRelease는 overlay를 **마지막 values 파일**로 얹는다. 평시 overlay는 첨부 예시 시각을 비운다(D-49).
4. `.github/workflows/peak-mode.yml`이 10분마다 overlay를 계산하고(저장소 변수 `PEAK_MODE_ENABLED=true`일 때만 — 켜 두기만 해도 Actions 시간을 쓰므로 opt-in), 바뀐 경우에만 전용 SSH 키로 서명 커밋해
   `main`에 push한다. overlay 밖의 파일이 바뀌면 커밋하지 않는다. 서명키는 보호된 environment secret에만 둔다.
5. 앱은 `PEAK_MODE_ACTIVATES_AT`부터 `PEAK_MODE_ENDS_AT`까지 비핵심 작업을 억제한다. 사전 확장(`enabled`)이
   먼저 켜져도 억제는 예약 시각에 시작하고, 종료 시각이 지나면 overlay가 늦게 바뀌어도 스스로 억제를 푼다.
6. CI(`npm run test:m4:gitops`)는 예약 문법과 "overlay가 평시이거나 예약된 창 하나를 그대로 옮긴 것"만 확인한다.
   시각에 따라 달라지는 판정은 CI에 넣지 않는다.

## 결과

- 확장·원복이 대학 클러스터 밖에서 Git 쓰기만으로 일어나고, 대학 클러스터는 Flux 서명 검증을 그대로 거친다.
- 각 대학은 `wonseoro-git-authors` Secret에 예약 자동화 공개키를 **추가로** 신뢰해야 한다. 이 키는 Flux가 HEAD
  서명만 보므로 내용까지 제한하지 못한다 — 워크플로의 overlay 경로 검사와 environment 보호가 그 통제다.
  더 강한 통제(경로별 서명 정책·별도 저장소 분리)는 M5 공급망 게이트에서 다시 본다.
- GitHub 예약 실행은 늦을 수 있다. 시작 지연은 `leadMinutes`가, 종료 지연은 앱의 `PEAK_MODE_ENDS_AT`이 흡수한다.
  남는 위험은 "조금 늦게 줄어드는 확장"이다.
- 로컬 kind 축소 환경에서 예약 창 시작 서명 커밋 → Flux 수렴 → API replica 2→3·억제/종료 env 전달(push 뒤 62초),
  종료 커밋 → 2로 원복(33초)을 확인했다 — `tests/m4/results/peak-mode-gitops-2026-09-29T11-43-36-484Z.json`.
  GitHub 예약 워크플로 자체와 운영 서명 주체는 실제 저장소 설정이 필요해 검증하지 않았다.
