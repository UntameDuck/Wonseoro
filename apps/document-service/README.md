# document-service — 악성코드 검사 워커

담당: 송리안 · 근거: 기술설계서 v1.0 §5.4, v1.1 §B5, **ADR-0004**

> **검사 워커가 동작한다.** 다만 엔진은 아직 Mock 이다 — 실 안티바이러스 연동은 M5. (T-M5-08)

## 역할 분담 (ADR-0004)

서류의 **공개 API 와 상태 전이는 `admission-api` 에 있다.**
OpenAPI 가 서류 엔드포인트를 University Data Plane API 의 같은 표면에 두고,
v1.0 §5.2 가 Admission API 를 단일 공개 진입점으로 규정하기 때문이다.

이 서비스는 **검사만** 맡는다.

```
admission-api  : upload-intent 발급 → 업로드 후 magic-byte·해시 검증 → QUARANTINED
document-service: QUARANTINED 서류를 가져가 검사 → applyScanResult(CLEAN|MALICIOUS|ERROR)
admission-api  : CLEAN 이면 AVAILABLE, 아니면 REJECTED
```

분리하는 이유는 하나다. **검사는 오래 걸리고 CPU 를 쓴다.**
마감 피크에 접수 트랜잭션과 자원을 다투면 안 된다.

## 현재 구현 (M2)

`QUARANTINED` 서류를 주기적으로 가져가 검사하고 `admission-api` 에 결과를 보고한다.
보고는 고정 Idempotency-Key(`scan-<documentId>`)를 쓴다 — 워커가 재시작해도
같은 서류의 검사 결과가 두 번 반영되지 않는다.

`SCANNER_ENGINE=mock` 은 **운영에서 선택되면 프로세스가 기동하지 않는다.**
검사했다는 기록만 남고 실제로는 아무것도 검사하지 않은 상태가 가장 위험하기 때문이다.

설정은 `.env.example` 참조.

## M5 구현 범위

- QUARANTINED 서류 폴링 또는 이벤트 구독
- 실제 안티바이러스 엔진 연동 (`document_scan.scanner`, `engine_version` 기록)
- 검사 지연 시 정책 — 마감 직전에 검사가 밀리면 어떻게 할지는 **업무규정**이 정한다
- Zip Bomb·매크로 심층 검사 (현재는 허용 목록으로 형식 자체를 막는다)
