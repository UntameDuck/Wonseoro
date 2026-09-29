# ADR-0005 — 대학별 Pull GitOps 실행 주체로 Flux 채택

- 상태: 채택
- 날짜: 2026-09-29
- 관련: T-M4-05, T-M4-07, D-48, 기술설계서 v1.0 §13.1·v1.1 §05

## 맥락

중앙 Plane은 대학 클러스터에 배포 권한을 가지면 안 된다. 각 대학 Data Plane이 승인된 저장소에서
원하는 상태를 Pull해야 하며, 변조된 배포 소스와 태그 이동으로부터 보호되어야 한다. 동시에 애플리케이션
Pod에 Kubernetes 수정 권한을 주지 않고도 향후 Peak Mode 예약 확장을 실행할 주체가 필요하다.

## 결정

각 대학 클러스터에 Flux를 독립 설치한다. `source-controller`가 저장소 `main` HEAD의 SSH/PGP 서명을
대학이 보유한 공개키로 검증하고, 검증된 revision만 `kustomize-controller`와 `helm-controller`가 Pull한다.
대학별 `HelmRelease`는 동일 차트와 해당 Size Profile·대학 values만 조합한다.

`HelmRelease.spec.serviceAccountName=release-controller`로 네임스페이스 범위 권한을 강제한다. 이 계정은
`kadmission-app`의 워크로드와 Helm release Secret만 관리할 수 있고 ClusterRole·CRD·다른 namespace를
변경할 수 없다. 중앙에는 kubeconfig나 대학 클러스터 토큰을 두지 않는다.

운영 차트는 이미지 digest가 비어 있거나 자리표시자이면 렌더링 단계에서 실패한다. 컨테이너 이미지의
Cosign 서명을 admission 단계에서 검증하는 정책은 실제 Registry·서명 주체·신뢰키를 확정한 뒤
T-M5 공급망 보안 게이트에서 활성화한다. 따라서 T-M4-05의 서명 검증 대상은 Git 배포 소스이며,
이미지에 대해서는 이 단계에서 digest 고정까지만 보장한다.

## 결과

- 중앙 Push 없이 대학 클러스터가 1분 간격으로 원하는 상태를 수렴한다.
- 서명되지 않았거나 신뢰하지 않는 HEAD는 Source가 Ready가 되지 않아 배포로 이어지지 않는다.
- 대학별 코드 fork 없이 같은 차트와 서로 다른 values를 사용한다.
- D-48의 실행 주체는 정해졌지만, 예약 시각에 Peak Mode desired state를 바꾸는 자동화는 별도 구현이 필요하다.
