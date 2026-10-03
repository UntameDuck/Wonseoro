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
