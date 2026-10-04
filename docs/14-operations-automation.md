# 운영 자동화 — 만료 경보·WORM·복구 검증·Writer fencing

> 기준일: 2026-10-04 · 대상 태스크: **T-M5-65**(인증서·Secret 만료 사전 경보) · **T-M3-03**(감사 기록 WORM 물리 분리) ·
> **T-M5-62**(복구 검증 자동화) · **T-M5-63**(Writer fencing·Promotion lock) · 외부 실행 준비 **T-M4-06·T-M5-60·61·64**(HA·PITR·DR 사전 점검)
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
- **시험** — 실제 S3 호환 Object Storage 3개: 내보내기·이어서 겹치지 않음, 보관 중 잠긴 객체 버전 지우기·보관 단축 거절(COMPLIANCE), 슈퍼유저가 트리거를 끄고 고친 기록·지운 기록을 찾는다. 저장소가 없으면 건너뛴다. D-83 로컬 RustFS 교체 뒤 **3개 모두 skip 없이 통과**했다(2026-10-04)
- **남은 것** — 대조를 정기 작업·경보로(지금은 함수·시험). 운영 버킷 IaC. 노션(D-75)

### T-M5-63 ✅ (2026-10-03) — Writer fencing·승격 잠금 (D-76)

- **문제** — 옛 Primary 가 쓰기 가능한 채로 돌아오면 주소가 늦게 바뀐 Pod 가 거기에 쓴다(split-brain). 옛 Primary 는 자기가 옛것인지 모른다
- **마이그레이션 `0006_writer_fence.sql`** — `writer_fence`(세대·require_token), 업무 표 전부의 문장 단위 트리거 `writer_fence_check`(SECURITY DEFINER), 승격 함수 `promote_writer(새 세대, 누가)`(advisory lock·대기 DB 거절·하나씩만)
- **앱** — `server-kit` Db 가 `WRITER_EPOCH` 를 트랜잭션마다 `SET LOCAL` 로 넘긴다(PgBouncer 트랜잭션 풀링). 트랜잭션 밖 쓰기 문장(INSERT·UPDATE·DELETE·WITH…)도 짧은 트랜잭션으로 감싼다. 거절되면 503 재시도 안내
- **승격 순서** — `pg_promote()` → 새 Primary 에서 `promote_writer(세대+1)` → `WRITER_EPOCH` 배포. 그 사이 쓰기는 멈춘다(안전한 쪽). 운영은 `require_token` 을 켠다
- **시험** — 실제 DB 5개(세대 일치 쓰기, 승격 뒤 옛 세대 거절·읽기 그대로, 돌아온 옛 Primary 거절, 승격 잠금·건너뛰기 거절·앱 역할 불가, require_token). require_token 시험은 커밋하지 않는 트랜잭션 안에서만 켠다(동시에 도는 다른 시험이 보지 않게)
- **남은 것** — 차트 `database.writerEpoch` 운영값과 `require_token` 켜기, [DR 런북 실행 초안](18-pilot-execution-package.md#3-t-m6-08--sev13-운영-런북)의 기관 승인·실훈련. 노션(D-76)

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

### 외부 PostgreSQL HA 사전 점검 — T-M4-06·T-M5-60·61·64 실행 준비 (2026-10-04)

- **`scripts/ops/ha-preflight.mjs`**(`npm run ops:ha-preflight`) — Primary·Standby 관리자 주소에 각각 **읽기 전용 트랜잭션**으로 접속한다. URL·자격증명은 결과에 쓰지 않는다
  - 역할: Primary는 `pg_is_in_recovery=false`, Standby는 `true`
  - 계보·격리: 같은 PostgreSQL major와 `system_identifier`, 다른 서버 주소
  - 복제: Primary의 `pg_stat_replication`에 `streaming` + `sync|quorum` 1개 이상, 기관이 정한 허용 WAL 지연 byte 이하, Standby `pg_stat_wal_receiver=streaming`, `hot_standby=on`
  - PITR 준비: `archive_mode=on|always`, 실제 archive command 설정. 명령 문자열은 비밀이 섞일 수 있어 결과에 남기지 않고 설정 여부만 기록
  - 단일 Writer: 운영 `writer_fence.require_token=true`, 승인 실행계획의 예상 epoch와 일치
- **의도적으로 자동 판정하지 않는 것** — 서로 다른 zone이라는 CSP 증적, 백업/WAL 원격 소산, 실제 백업의 목표시각 PITR, 부하 중 Failover와 전체 DR의 RTO/RPO, DNS/Edge·옛 Writer fencing·사후 Reconciliation. 이 다섯 가지는 사람 증적으로 결과에 항상 남는다
- **검증** — 판정기 단위 3개 통과·건너뜀 0. 이 PC의 서로 독립된 Primary DB 두 개를 Primary/Standby처럼 넣은 음성 대조는 자동 13개 중 7개만 통과하고 역할·계보·동기복제·WAL receiver·archive·writer token 6개를 정확히 실패했다. **운영 HA 환경 실행은 아직 없다**

외부 실행 예시:

```powershell
$env:PRIMARY_DATABASE_URL = 'postgresql://통제된-관리계정@primary/대학DB'
$env:STANDBY_DATABASE_URL = 'postgresql://통제된-관리계정@standby/대학DB'
npm run ops:ha-preflight -- --environment=pilot-staging-a --approval=기관-티켓 --expected-writer-epoch=1 --max-replay-lag-bytes=기관-승인값
```

자동 점검 통과는 HA/PITR/DR 태스크 완료가 아니라 **실훈련 진입 조건**이다.

### T-M6-02 ✅ (2026-10-03) — Config 호환 시험 (D-77)

- 설정 자체 검사(Config Linter)·위험도 Diff 는 있었다(D-59). 빠져 있던 것은 **진행 중 원서와의 호환** — 줄인 최대 글자 수·바뀐 형식·새 필수 항목이 이미 쓴 원서를 깨는지
- **`modules/config/config-compat.ts`** — 적용 직전 이 주기의 진행 중 원서를 새 양식(런타임과 같은 Ajv)으로 검사. 작성 중은 저장된 값만, 검증 끝·결제 중·결제 완료는 필수까지. 하나라도 깨지면 **적용 거절**, 승인 화면(Diff)에 미리 경고(전형·항목 경로·건수)
- **시험** — 실제 DB 4개(맞는 설정 통과, 최대 글자 수 축소·형식 변경 감지, 새 필수 항목은 검증 끝 원서만)
