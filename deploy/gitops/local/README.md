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

운영 배포에는 이 디렉터리를 적용하지 않는다.
