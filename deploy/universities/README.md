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

## Peak Mode 예약 (T-M4-07, ADR-0006)

| 파일 | 누가 쓰나 | 내용 |
|---|---|---|
| `peak-schedule.yaml` | 사람 (배포 리뷰) | 예약 창 — 사전 확장 `scaleOutAt` · 작업 억제 `suspendJobsAt` · 원복 `endsAt` · 선택 `apiMinReplicas` |
| `peak-mode.yaml` | **예약 워크플로만** | 지금 적용할 Peak 상태. HelmRelease 의 마지막 values. 손으로 고치면 CI 가 거부한다 |

예약 창은 **용량 예약이지 마감시각이 아니다.** 마감 판정은 여전히 서명된 마감정책으로만 바뀐다.

```bash
node scripts/peak-mode-sync.mjs --now 2027-09-07T00:00:00+09:00   # 그 시각에 무엇이 바뀔지
npm run test:m4:peak-schedule                                    # 예약 문법·overlay 일관성
```
