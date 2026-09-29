# 로컬 Flux 검증

운영 bootstrap과 달리 로컬 kind는 개발 이미지·Secret을 쓰지만 Git HEAD 서명 검증은 그대로 켠다.
시험용 bare repository를 `http://host.docker.internal:9418/Wonseoro.git`에서 제공하고, 임시 SSH 공개키를
`wonseoro-git-authors` Secret에 넣는다. 개인키와 bare repository는 저장소 밖 `E:\DockerData`에 둔다.
bare repository의 read-only smart HTTP는 다음 보조 스크립트로 연다.

```powershell
node tests/m4/helpers/git-smart-http-server.mjs E:\DockerData\gitops-test 9418
```

검증 기준:

1. 신뢰하지 않는 키 또는 unsigned HEAD에서는 `GitRepository`가 Ready가 되지 않는다.
2. 신뢰한 SSH 키로 서명한 HEAD에서는 `SourceVerifiedCondition=True`다.
3. `Kustomization`과 `HelmRelease`가 Ready이고 기존 `univ-a` release를 수렴시킨다.
4. `release-controller`는 `kadmission-app` 밖과 ClusterRole·CRD를 수정할 수 없다.

## Peak Mode 예약 전환 시험 (T-M4-07)

위 환경(Flux 리소스는 suspend 상태여도 된다)에서:

```bash
node tests/m4/peak-mode-gitops.mjs --git-root E:/DockerData/gitops-test-<날짜> --work E:/DockerData/gitops-test-<날짜>/work
```

시험 사본에 dev-folder `main` 을 서명 병합하고, 지금 시작하는 예약 창을 넣어 생성기로 overlay 를 만든 서명 커밋을
push 한다. Flux 를 재개해 API replica 2→3 과 `PEAK_MODE_*` env 를 확인하고, 종료 시각 기준 overlay 로 2 로 되돌린 뒤
Flux 를 다시 suspend 한다. 서명키는 시험 사본의 git 설정에 있는 임시 키를 쓰며 스크립트는 키를 읽지 않는다.

운영 배포에는 이 디렉터리를 적용하지 않는다.
