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

### T-M5-63 ✅ (2026-10-03) — Writer fencing·승격 잠금 (D-76)

- **문제** — 옛 Primary 가 쓰기 가능한 채로 돌아오면 주소가 늦게 바뀐 Pod 가 거기에 쓴다(split-brain). 옛 Primary 는 자기가 옛것인지 모른다
- **마이그레이션 `0006_writer_fence.sql`** — `writer_fence`(세대·require_token), 업무 표 전부의 문장 단위 트리거 `writer_fence_check`(SECURITY DEFINER), 승격 함수 `promote_writer(새 세대, 누가)`(advisory lock·대기 DB 거절·하나씩만)
- **앱** — `server-kit` Db 가 `WRITER_EPOCH` 를 트랜잭션마다 `SET LOCAL` 로 넘긴다(PgBouncer 트랜잭션 풀링). 트랜잭션 밖 쓰기 문장(INSERT·UPDATE·DELETE·WITH…)도 짧은 트랜잭션으로 감싼다. 거절되면 503 재시도 안내
- **승격 순서** — `pg_promote()` → 새 Primary 에서 `promote_writer(세대+1)` → `WRITER_EPOCH` 배포. 그 사이 쓰기는 멈춘다(안전한 쪽). 운영은 `require_token` 을 켠다
- **시험** — 실제 DB 5개(세대 일치 쓰기, 승격 뒤 옛 세대 거절·읽기 그대로, 돌아온 옛 Primary 거절, 승격 잠금·건너뛰기 거절·앱 역할 불가, require_token). require_token 시험은 커밋하지 않는 트랜잭션 안에서만 켠다(동시에 도는 다른 시험이 보지 않게)
- **남은 것** — 차트 `database.writerEpoch` 값과 DR 런북(T-M6-08), 운영 `require_token` 켜기. 노션(D-76)

### T-M5-62 ✅ (2026-10-03) — 복구 검증 자동화

- **`scripts/ops/restore-verify.mjs`**(`npm run ops:restore-verify`) — 원본에서 REPEATABLE READ 스냅숏을 내보내 **같은 시점**으로 덤프(`pg_dump --snapshot`)·체크섬을 잡고, 매번 새 PostgreSQL 컨테이너에 복구한 뒤 맞춘다
  - 표마다 행 수·체크섬(행 글자를 정렬해 md5) 원본 = 복구본
  - 자기 시험 — 복구본 한 행을 바꾸면 체크섬이 달라지는지(검사가 늘 "같다" 고만 하지 않게)
  - 업무 불변식 — 접수 1건/원서, 접수된 원서는 FINALIZED·확정 결제, FINALIZED 는 접수 기록, Outbox 순번 유일, 감사 체인 앞 해시 연결
  - DB 제약 검사 `verify-constraints.sql`(PASS 22) 을 복구본에
- **매달** `.github/workflows/restore-verify.yml`(매월 1일, 수동 실행 가능) — 시드·통합 시험이 만든 데이터로
- **찾은 것** — 처음 돌리자 복구가 외래키 위반으로 멈췄다. 시험 정리 코드(`breakGlass`)가 외래키 검사를 끈 채 원서를 지워 연쇄 삭제가 안 되고 데이터 키가 남았다. 정리 코드가 남은 자식 행을 치우게 고쳤다 — 복구 검증이 "백업이 복구되지 않는 DB" 를 실제로 잡는다
- **운영** — 원본 대신 백업 저장소(PITR 기본 백업 + WAL, T-M5-61)에서 복구한 DB 를 같은 검사에 넣는다. 복구 시간도 결과에 남는다
- 로컬 결과: 표 25개·행 118, 11개 통과(복구 3.9초)

## 시범 운영 도구 (T-M6)

### T-M6-03 ✅ (2026-10-03) — CSP 적합성 사전 점검

- **`scripts/ops/csp-preflight.mjs`**(`npm run ops:csp-preflight -- --context=<컨텍스트>`) — 새 클러스터(K-PaaS·CSP)가 차트에 필요한 능력을 갖췄는지 **실제로 만들어 보고** 지운다(점검용 네임스페이스). 필수가 없으면 종료 코드 1
  - 필수: Kubernetes ≥ 1.30 · ValidatingAdmissionPolicy API · 기본 StorageClass · 노드 zone 2개 이상 · Pod Security restricted 가 위반 Pod 거절 · **NetworkPolicy 가 실제로 막는다**(정책 전 열림 → 정책 뒤 막힘 — 정책을 모르는 CNI 는 조용히 통과시킨다) · LoadBalancer 주소 발급
  - 권장: Gateway API(ingress-nginx 은퇴 D-53) · 메트릭 API(HPA) · 볼륨 확장
  - 사람: 저장 데이터 암호화(KMS)·백업 소산·KCMVP·Object Lock 지원·노드 장애 판정 시간 — API 로 알 수 없어 질문으로 남긴다
- **kind-univ-a 결과(축소 환경)** — 필수 7개 중 5개 충족. 없는 것: zone 2개(단일 노드), LoadBalancer(kind 에는 없다 — NodePort 로 대신). NetworkPolicy 는 정책 전 `open` → 정책 뒤 `timeout` 으로 실제로 막힘. 권장 셋 없음(Gateway API·메트릭 API·볼륨 확장)

