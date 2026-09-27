# OpenAPI

`k-admission.v1.yaml`이 CI의 계약 기준이다. lint · breaking-change 검사 · contract test를 여기에 건다.

**v1.2.0 — 저장소 구현에 맞췄다 (2026-09-27).** 노션 v1.1 §03 첨부(v1.1.0, 29개)에 없던 오퍼레이션 23개와
응답 형태를 구현 그대로 적었다. 구현이 먼저 나간 경로에는 `x-kadmission-register: D-n` 을 달았다.
노션 §03 첨부는 이 파일로 교체한다.

**드리프트 방지** — `apps/admission-api/src/contract-conformance.test.ts` 가 세 앱(admission-api ·
central-api · event-relay)의 컨트롤러를 훑어 **계약에 없는 경로가 있으면 실패**한다. 계약에서 일부러
뺀 경로는 같은 파일의 `CONTRACT_EXEMPT` 에 이유와 함께 둔다. 외부 콜백이 아닌 mutation 에
`Idempotency-Key` 가 빠져도 실패한다.

## 엔드포인트

### Applicant API
```
GET    /api/v1/meta/time
GET    /api/v1/meta/operating-mode                        D-34
GET    /api/v1/meta/signing-keys                          D-35
GET    /api/v1/admission-cycles/current
GET    /api/v1/admission-types
GET    /api/v1/departments
POST   /api/v1/applications
GET    /api/v1/applications/{applicationId}
PATCH  /api/v1/applications/{applicationId}
POST   /api/v1/applications/{applicationId}/validate
GET    /api/v1/applications/{applicationId}/form-schema   D-19
GET    /api/v1/applications/{applicationId}/self-check    D-16
POST   /api/v1/applications/{applicationId}/cancel        D-7 (접수 전만)
POST   /api/v1/applications/{applicationId}/documents/upload-intents
POST   /api/v1/documents/{documentId}/complete
DELETE /api/v1/documents/{documentId}
POST   /api/v1/applications/{applicationId}/payment-intents
GET    /api/v1/payments/{paymentId}
POST   /api/v1/payments/{paymentId}/verify
POST   /api/v1/payments/callbacks/{provider}              D-40 (PG 가 부른다 · Idempotency-Key 없음)
POST   /api/v1/applications/{applicationId}/finalize
GET    /api/v1/applications/{applicationId}/submission
GET    /api/v1/submissions/{submissionId}/receipt
```

### Admin API
```
GET    /admin/v1/config/active?cycleId=
GET    /admin/v1/config/versions?cycleId=                 D-35
POST   /admin/v1/config/versions
GET    /admin/v1/config/versions/{configId}/diff          T-M3-02
POST   /admin/v1/config/versions/{configId}/approve       (acknowledgedDiffDigest 필수)
POST   /admin/v1/config/versions/{configId}/activate
POST   /admin/v1/config/versions/{configId}/rollback      T-M3-02
GET    /admin/v1/deadline-policies?cycleId=
POST   /admin/v1/deadline-policies
POST   /admin/v1/deadline-policies/extensions             D-35
POST   /admin/v1/deadline-policies/{policyId}/approve
POST   /admin/v1/deadline-policies/{policyId}/activate    D-22
GET    /admin/v1/activations?cycleId=                     D-35
GET    /admin/v1/reconciliation/exceptions?state=
POST   /admin/v1/reconciliation/run                       D-26
POST   /admin/v1/reconciliation/{exceptionId}/resolve
GET    /admin/v1/evidence/applications/{applicationId}?reason=   D-24
GET    /admin/v1/retention/matrix                         D-38
GET    /admin/v1/retention/plan?cycleId=                  D-38
```

### Internal · Ops · Central
```
GET    /internal/v1/documents/pending-scan                D-20 (AV 워커)
POST   /internal/v1/documents/{documentId}/scan-result    D-20
POST   /internal/v1/events                                중앙 Sync Gateway
GET    /internal/v1/events/{eventId}/receipt
GET    /internal/v1/sync/status                           대학 쪽 적체 (event-relay) · circuit D-32
GET    /healthz · /readyz · /healthz/dependencies         D-32 (Ops, 외부 Ingress 비노출)
GET    /api/v1/dashboard/applications                     중앙 · x-subject-token 헤더 (D-39)
POST   /internal/v1/profile-snapshots                     중앙 Vault (D-17)
```

## 공통 요구

- OAuth2/OIDC 또는 기관 승인 인증, 내부 연계는 mTLS
- Mutation은 `Idempotency-Key`, PATCH는 `If-Match`/ETag
- 오류는 `application/problem+json`
- `traceparent` / `X-Request-Id`
- 개인정보 응답은 `Cache-Control: no-store`
- URI Versioning `/api/v1/...`, 목록은 Cursor pagination
- 민감 데이터는 URL Query 금지, Body 사용
- 시간은 RFC 3339 (DB·전송은 UTC, 표시만 Asia/Seoul)
