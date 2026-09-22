# OpenAPI

`k-admission.v1.yaml`이 CI의 계약 기준이다. lint · breaking-change 검사 · contract test를 여기에 건다.

**아직 미배치.** 노션 v1.1 §03 첨부를 배치할 것 → `docs/spec-assets/README.md`

## 엔드포인트 (v1.1 §03)

### Applicant API
```
GET    /api/v1/meta/time
GET    /api/v1/admission-cycles/current
GET    /api/v1/admission-types
GET    /api/v1/departments
POST   /api/v1/applications
GET    /api/v1/applications/{applicationId}
PATCH  /api/v1/applications/{applicationId}
POST   /api/v1/applications/{applicationId}/validate
POST   /api/v1/applications/{applicationId}/documents/upload-intents
POST   /api/v1/documents/{documentId}/complete
DELETE /api/v1/documents/{documentId}
POST   /api/v1/applications/{applicationId}/payment-intents
GET    /api/v1/payments/{paymentId}
POST   /api/v1/payments/{paymentId}/verify
POST   /api/v1/applications/{applicationId}/finalize
GET    /api/v1/applications/{applicationId}/submission
GET    /api/v1/submissions/{submissionId}/receipt
```

### Admin API
Config version 생성·승인·활성화 / Deadline Policy 생성·승인 / Reconciliation Exception 조회·처리 / Evidence Package 생성

### Internal API
중앙 Event 수신 / Event Receipt 조회 / Sync 상태 조회

## 공통 요구

- OAuth2/OIDC 또는 기관 승인 인증, 내부 연계는 mTLS
- Mutation은 `Idempotency-Key`, PATCH는 `If-Match`/ETag
- 오류는 `application/problem+json`
- `traceparent` / `X-Request-Id`
- 개인정보 응답은 `Cache-Control: no-store`
- URI Versioning `/api/v1/...`, 목록은 Cursor pagination
- 민감 데이터는 URL Query 금지, Body 사용
- 시간은 RFC 3339 (DB·전송은 UTC, 표시만 Asia/Seoul)
