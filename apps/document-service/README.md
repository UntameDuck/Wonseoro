# document-service — 악성코드 검사 워커

담당: 송리안 · 근거: 기술설계서 v1.0 §5.4, v1.1 §B5, **ADR-0004**

> **검사 워커가 동작한다.** 엔진은 `SCANNER_ENGINE` 으로 고른다 — `clamav`(clamd INSTREAM, D-58) 또는 개발용 `mock`.
> 단위 시험의 가짜 clamd뿐 아니라 **실 clamd 1.4·공식 서명 DB**로 EICAR·압축 안 EICAR·크기 한도·Zip/PDF 폭탄·PDF 능동 콘텐츠·정상 PDF까지 10개를 확인했다(T-M5-08, D-73, `npm run test:security:clamd`).

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

## 현재 구현

`QUARANTINED` 서류를 주기적으로 가져가 검사하고 `admission-api` 에 결과를 보고한다.
보고는 고정 Idempotency-Key(`scan-<documentId>`)를 쓴다 — 워커가 재시작해도
같은 서류의 검사 결과가 두 번 반영되지 않는다(상태 전이는 "QUARANTINED 일 때만" 조건부다).

**ClamAV 엔진** (`engines.ts`, D-58)

```
접수 API ─ 검사 대기 목록(downloadUrl: 파일 하나·몇 분짜리 서명 URL) ─→ 워커
워커 ─GET→ Object Storage   파일을 받아 흘려보내며 SHA-256 계산
워커 ─zINSTREAM→ clamd      [4바이트 길이 + 조각] … [0000]  →  OK | <이름> FOUND | … ERROR
워커 ─scan-result→ 접수 API  scanner=clamav · engineVersion=clamd 가 답한 엔진/서명 DB 버전 · signature
```

- 워커는 Object Storage 자격증명이 없다. 서명 URL 이 가리키는 파일만 읽는다
- 받은 바이트의 해시가 기록과 다르면 `ERROR(CONTENT_MISMATCH)` — 다른 바이트의 판정을 그 서류에 붙이지 않는다
- clamd·저장소에 닿지 못하면 **판정하지 않는다** — 서류는 검사 대기로 남고 다음 주기에 다시 가져온다
- 설정: `SCANNER_ENGINE=clamav` · `CLAMD_HOST`(필수) · `CLAMD_PORT`(3310) · `CLAMD_TIMEOUT_MS`. 차트는 `documentService.clamav.host`·`scannerEgress`(clamd·Object Storage 출구)

`SCANNER_ENGINE=mock` 은 파일을 읽지 않는 흉내다 — **운영에서 선택되면 프로세스가 기동하지 않는다.**
검사했다는 기록만 남고 실제로는 아무것도 검사하지 않은 상태가 가장 위험하기 때문이다.

설정은 `.env.example` 참조.

## 운영 환경에서 정할 것

- clamd 배치 — 같은 Pod 사이드카 또는 대학 공용 서비스. 서명 DB 갱신 경로(freshclam 출구)
- 검사 지연 시 정책 — 마감 직전에 검사가 밀리면 어떻게 할지는 **업무규정**이 정한다
