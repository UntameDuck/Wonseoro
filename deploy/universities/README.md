# 대학별 배포 값

대학을 추가할 때 디렉터리 하나를 복제한다. **코드도, 차트도 건드리지 않는다.** (v1.1 §A5)

```
helm upgrade --install <release> deploy/charts/k-admission   -f deploy/charts/k-admission/values-<s|m|l>.yaml   -f deploy/universities/<ID>/values.yaml
```

`values.yaml` 에 들어가는 것: 대학 식별자 · Size Profile 보정 · 이미지 digest · DB/Redis/Object Storage 주소 ·
중앙 Sync 주소 · 런타임 Secret 이름 · 네트워크 출구.

**들어가지 않는 것 — 마감시각·전형료·전형 양식(Config) 버전.** 이것들은 배포로 바꾸지 않는다.
관리자 콘솔에서 2인 승인 → 서명된 활성화 기록으로만 바뀐다 (D-21 · D-35 · D-44 ⑥).
배포 값으로 넣을 수 있으면 배포 권한 한 사람이 마감을 바꿀 수 있게 된다.
(전에 이 README 가 적던 `config-ref.yaml` 은 그래서 두지 않는다.)
