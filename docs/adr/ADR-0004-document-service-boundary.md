# ADR-0004. 서류 API 는 admission-api 에, AV 검사 워커는 document-service 에 둔다

- 상태: 채택 (2026-09-22)
- 관련: 기술설계서 v1.0 §5.2·§5.4, v1.1 §05, ADR-0002

## 맥락

저장소 골격에서 `apps/document-service` 를 별도 배포 단위로 만들어 뒀다. (v1.1 §05 GitOps 구조)
그런데 canonical OpenAPI 는 서류 엔드포인트를 **University Data Plane API 의 같은 표면**에 둔다.

```
POST /api/v1/applications/{applicationId}/documents/upload-intents
POST /api/v1/documents/{documentId}/complete
DELETE /api/v1/documents/{documentId}
```

v1.0 §5.2 도 Admission API 를 "모든 Domain API 의 단일 공개 진입점"으로 규정한다.
서류만 다른 호스트로 빼면 이 원칙이 깨진다.

## 결정

**공개 API 는 `admission-api` 에 둔다. `document-service` 는 AV 검사 워커가 된다.**

| 책임 | 위치 | 이유 |
|---|---|---|
| upload-intent 발급, 업로드 후 검증, 상태 전이 | `admission-api` | 단일 공개 진입점 원칙. 처리량도 가볍다 |
| AV 검사 | `document-service` | 비동기·CPU 부하. 접수 API 와 자원을 나눠야 한다 |
| 파일 바이트 | Object Storage | 브라우저가 직접 올린다. API 서버를 지나지 않는다 |

## 근거

분리가 실제로 필요한 부분은 **악성코드 검사**다. 검사는 오래 걸리고 CPU 를 쓰며,
마감 피크에 접수 트랜잭션과 자원을 다투면 안 된다. (v1.1 §B5)

반면 Presigned URL 발급과 magic-byte 검증은 수 밀리초짜리 작업이고,
application 상태·감사로그와 같은 트랜잭션 경계 안에 있어야 한다.
이것까지 별도 서비스로 빼면 분산 트랜잭션 문제가 생긴다.

## 현재 상태

- `admission-api` 의 `modules/document` 가 API 와 상태 전이를 담당한다
- `applyScanResult()` 가 검사 결과를 받는 진입점이다. M1 은 Mock
- M5 에서 `document-service` 를 실제 스캐너 워커로 구현하고 이 메서드를 호출하게 한다 (T-M5-08)

## 대가

`document-service` 가 M5 까지 비어 있다. 저장소에 빈 디렉터리가 남는 것보다
역할을 명시해 두는 편이 낫다고 판단했다. README 에 적어 둔다.
