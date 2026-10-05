# CloudEvents

`k-admission-cloudevents.schema.json`이 저장소의 canonical JSON Schema다. 파일은 배치됐고, 현재 저장소 판이 노션 첨부보다 앞서므로 바이트 그대로 교체 승인 대기 중이다 → `docs/spec-assets/README.md`, `docs/06-notion-changeset.md`

TypeScript 타입 정의는 `../src/events.ts`에 있으며, `npm run check:contracts`가 스키마 이벤트 타입과 코드의 타입 목록을 대조한다.

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
