# CloudEvents

`k-admission-cloudevents.schema.json`이 canonical JSON Schema다. **아직 미배치** → `docs/spec-assets/README.md`

TypeScript 타입 정의는 `../src/events.ts`에 있으며, 스키마 배치 후 생성기로 대체한다.

## 이벤트 (v1.1 §04)
```
kr.kadmission.application.finalized.v1
kr.kadmission.application.cancelled.v1
kr.kadmission.payment.confirmed.v1
kr.kadmission.payment.refunded.v1
kr.kadmission.sync.heartbeat.v1
```

## 확장 속성
`kadmissionuniversity` `kadmissionsequence` `configversion` `policyversion` `traceparent`

## 순서·중복
- aggregate = `applicationId`, sequence는 Application별 단조 증가
- 중앙 dedup key = `source` + `id`
- sequence gap은 경보 및 재전송 대상
