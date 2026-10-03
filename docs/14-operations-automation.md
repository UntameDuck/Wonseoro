# 운영 자동화 — 만료 경보·WORM·복구 검증·Writer fencing

> 기준일: 2026-10-03 · 대상 태스크: **T-M5-65**(인증서·Secret 만료 사전 경보) · **T-M3-03**(감사 기록 WORM 물리 분리) ·
> **T-M5-62**(복구 검증 자동화) · **T-M5-63**(Writer fencing·Promotion lock)
>
> 설계 원본: 노션 §01 B9(만료 30/14/7/3/1일, rotation drill)·A11(감사 분리 저장소)·B10(월별 자동 복구 + checksum·row-count·업무 불변식)·A10(Split-brain 방지, 단일 Writer).

## 진행

### T-M5-65 ✅ (2026-10-03) — 인증서·자격증명 만료 사전 경보

- **지표** `credential_expiry_timestamp_seconds{kind, name}`(`server-kit/src/expiry.ts`) — 모든 서비스가 기동 때(`startVaultSecrets`) 낸다
  - `workload-cert` 상호 TLS 인증서, `ca-cert` 플랫폼 CA — 파일의 notAfter. 파일이 바뀌면(Vault 재발급·Secret 교체) 다시 읽는다
  - `db-credential` Vault DB 동적 계정의 임대 끝 — 교체할 때마다 갱신
  - 다른 것(서명키·외부 인증서)은 `recordExpiry(kind, name, 날짜)` 로 더한다
- **경보 규칙** `deploy/platform/observability/expiry-rules.yaml`(Prometheus chart values, `kpi-rules.yaml` 과 같이 적용)
  - 오래 쓰는 것(CA·외부 인증서·키): **30/14/7/3/1일** 날짜 경보(info → warning → critical, 1일은 호출)
  - 짧게 쓰는 것은 정상일 때도 하루 안에 끝난다 → 날짜 대신 **갱신 멈춤** 경보. 워크로드 인증서는 남은 시간 8시간 아래(24시간짜리를 16시간째에 다시 받으므로 두 번 연속 실패), DB 계정은 10분 아래(1시간짜리를 40분째에 바꾸므로 교체 멈춤 — 끝나면 Vault 가 세션을 끊는다)
  - CA 만료 지표가 사라지면 경보(경보가 꺼진 것과 같다)
- **교체 훈련(rotation drill)** — `npm run test:security:vault` 가 인증서 재발급(서버·클라이언트 무중단)·DB 계정 교체(40초 동안 3번, 실패 0)·Transit 키 돌리기·rewrap 을 실제로 한다. 필드 KEK 교체는 admission-api `field-cipher.integration.test`
- **시험** — server-kit 단위 3개(인증서 파일 만료·갱신 뒤 새 시각, 임대 끝 알리기·지우기, 규칙 5단계·갱신 멈춤이 같은 지표), Vault 실증에 "실제 대학 API 가 세 종류 만료 지표를 낸다" 1개(**24개**)

### T-M3-03 ✅ (2026-10-03) — 감사 기록 WORM 물리 분리 (D-75)

- **왜** — DB 안 감사 기록은 앱 권한·추가 전용 트리거·hash-chain 으로 지킨다. 그러나 DB 슈퍼유저는 트리거를 끄고 고치거나 지울 수 있고, 지운 것은 되찾지 못한다
- **`apps/admission-api/src/modules/audit/audit-worm.ts`**
  - 내보내기 — 5분마다(리더 하나·Peak Mode 억제) (시각, id) 순서의 NDJSON 조각을 Object Lock **COMPLIANCE** 로 올린다(보관 기본 5년, `AUDIT_WORM_RETENTION_DAYS`). Content-MD5·sha256 메타데이터
  - 이어 내보낼 자리는 키 이름 `audit/<대학>/<날짜>/<마지막 시각(µs)>_<마지막 id>.ndjson` 에서 읽는다 — DB 를 믿지 않으려고 만드는 것이라 DB 에 두지 않는다. 늦게 커밋된 기록을 놓치지 않게 2분 지난 것만
  - 대조 `verifyAuditWorm` — 조각과 DB 를 맞춰 **지워진 기록·고쳐진 기록**을 돌려준다
- **설정** — `AUDIT_WORM_BUCKET`(운영 필수 — 없으면 기동 거부, 개발은 비우면 끔), 차트 `objectStorage.auditWormBucket`. 버킷은 IaC 가 Object Lock 을 켜서 만든다(개발은 `S3_AUTO_CREATE_BUCKET`)
- **시험** — 실제 MinIO 3개: 내보내기·이어서 겹치지 않음, 보관 중 지우기·보관 단축 거절(COMPLIANCE), 슈퍼유저가 트리거를 끄고 고친 기록·지운 기록을 찾음. MinIO 가 없으면 건너뛴다(CI 통합 잡에는 MinIO 가 없다)
- **남은 것** — 대조를 정기 작업·경보로(지금은 함수·시험). 운영 버킷 IaC. 노션(D-75)
