# document-service — 악성코드 검사 워커

담당: 송리안 · 근거: 기술설계서 v1.0 §5.4, v1.1 §B5, **ADR-0004**

> **현재 비어 있다.** M5 에서 구현한다. (T-M5-08)

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

## M5 구현 범위

- QUARANTINED 서류 폴링 또는 이벤트 구독
- 실제 안티바이러스 엔진 연동 (`document_scan.scanner`, `engine_version` 기록)
- 검사 지연 시 정책 — 마감 직전에 검사가 밀리면 어떻게 할지는 **업무규정**이 정한다
- Zip Bomb·매크로 심층 검사 (현재는 허용 목록으로 형식 자체를 막는다)
