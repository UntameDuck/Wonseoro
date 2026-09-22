# document-service — 서류 서비스

담당: 송리안 · 근거: 기술설계서 v1.0 §5.4, v1.1 §B5

## 흐름

```
Presigned URL 발급 → 브라우저 → Object Storage 직접 업로드 → complete 호출
  → Hash / MIME / magic-byte / 확장자 / 크기 서버측 재검증
  → QUARANTINED → (AV 검사 통과) → AVAILABLE
```

## 규칙

- **API 서버를 경유해 파일을 올리지 않는다.** 대용량 트래픽을 Object Storage로 뺀다.
- 브라우저가 보낸 MIME을 신뢰하지 않는다. magic-byte로 판정한다.
- 실행파일·매크로·Zip Bomb 차단 (v1.1 §09 고위험 Abuse Case).
- 접수 확정에 필요한 필수서류는 **AVAILABLE 상태 기준**으로만 통과시킨다.
- AV 검사는 비동기. 검사 지연 시 정책은 사전에 정의되어 있어야 한다.
- 다운로드는 단기 Signed URL + 권한검사 + 감사로그.
