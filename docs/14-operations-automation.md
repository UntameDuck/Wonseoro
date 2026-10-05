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
- **정기 대조(2026-10-05)** — 대학 API 리더가 하루마다(`AUDIT_WORM_VERIFY_INTERVAL_MS`, 0 이면 끔) 감사 기록·권한 변경 기록의 조각 전부를 DB 와 맞춰 지표 `audit_worm_verify_mismatches{log,kind}`·`audit_worm_verify_last_success_seconds` 를 낸다. 경보 `AuditWormMismatch`(즉시·호출)·`AuditWormVerifyStale`(이틀). 지운·고친 ID 는 API 로그에만. 화면 시험 DB 로 스케줄러 경로를 한 번 돌려 내보내기 679줄·불일치 0 을 확인했다(그때 만든 로컬 버킷 `audit-worm-verify-once-*` 의 권한 변경 기록 조각은 3년 잠긴다 — 로컬 RustFS 에 남는다). 조각이 많아지면 하루 대조가 무거워진다 — 운영 규모에서 주기·범위를 다시 정한다
- **정기 대조가 재시작에 묶이지 않게(2026-10-05, D-93)** — 주기를 프로세스 타이머로만 세어 하루 안에 다시 뜨는 Pod 들만 있으면 대조가 돌지 않았고, 재시작하면 마지막 성공·불일치 수를 잃어 두 경보가 꺼졌다. 이제 마지막 대조 시각·불일치 수를 대학 DB `scheduled_job_run`(마이그레이션 **0012**)에 남기고, Pod 마다 10분마다 읽어 지표를 맞춘 뒤 주기가 지났으면 리더 하나가 대조한다. 앞날 시각은 믿지 않고, 프로세스가 주기만큼 대조하지 못했으면 DB 와 상관없이 대조한다(슈퍼유저가 줄을 고쳐 미뤄도). 대조를 켰는데 한 번도 끝난 적이 없으면 마지막 성공을 0 으로 낸다. 멈춤 경보는 주기 지표 `audit_worm_verify_interval_seconds` 의 두 배를 본다(주기를 사흘로 늘려도 거짓 경보가 없다).
- **다른 주기 작업도(2026-10-05, D-93)** — D+1 자동 대조·Outbox 보관·멱등 기록 정리(그리고 결제 재확인 워커·감사 WORM 내보내기의 마지막 성공)를 공통 도구 `common/scheduling/periodic-job.ts` 로 옮겼다: 때는 `scheduled_job_run` 의 마지막 성공으로(재시작해도 이어진다), 실패하면 남기지 않고, 모든 Pod 가 `scheduled_job_last_success_seconds{task}`·`scheduled_job_interval_seconds{task}`·`scheduled_job_suspended{task}` 를 낸다. 경보 `ScheduledJobStale`(주기의 두 배, Peak Mode 억제 중 제외, `expiry-rules.yaml`). 새 주기 작업을 만들면 이 도구를 쓴다 시험 `audit-worm.integration.test` 5개 통과·skip 0
- **경보 규칙 시험(2026-10-05, D-93)** — `npm run check:alert-rules`(CI contracts 잡): promtool check·test, 경보 12개 모두의 울릴 때·조용할 때([observability README](../deploy/platform/observability/README.md#규칙-검사경보-단위-시험)). 수집 경보 두 개의 결함(성공 뒤에도 울림·한 번도 성공 못 하면 안 울림)을 고쳤다
- **남은 것** — 운영 버킷 IaC. 노션(D-75)
- **권한 변경 기록(2026-10-05, G-15·D-91)** — 같은 스케줄러가 `access_grant_log` 도 순번으로 이어 `access-grants/<대학>/<날짜>/<순번 12자리>.ndjson` 으로 내보낸다(보관은 감사 WORM 보관과 1095일 중 긴 쪽). 대조 `verifyGrantWorm`. 시험 1개 추가(모두 4개 통과)

### 권한 부여·변경·말소 기록 수집 (2026-10-05, G-15·D-91)

- **작업** — 차트 `accessGrantSync` CronJob(1시간마다, `dist/tools/access-grant-sync.js`): 로그인 서버 관리 이벤트를 옮기고 실제 권한과 대조, 해시 체인 검증. 관리 이벤트가 꺼져 있거나 체인이 끊기면 종료 코드 1
- **경보** — `expiry-rules.yaml` 의 `AccessGrantSyncStale`(마지막 성공 3시간 넘음)·`AccessGrantSyncFailing`(Job 실패). kube-state-metrics 지표라 로컬 축소 스택(kube-state-metrics 끔)에서는 울리지 않는다. YAML 파싱만 확인했고 promtool 문법 검사는 못 했다(로컬에 Prometheus 이미지 없음)

### T-M5-63 ✅ (2026-10-03) — Writer fencing·승격 잠금 (D-76)

- **문제** — 옛 Primary 가 쓰기 가능한 채로 돌아오면 주소가 늦게 바뀐 Pod 가 거기에 쓴다(split-brain). 옛 Primary 는 자기가 옛것인지 모른다
- **마이그레이션 `0006_writer_fence.sql`** — `writer_fence`(세대·require_token), 업무 표 전부의 문장 단위 트리거 `writer_fence_check`(SECURITY DEFINER), 승격 함수 `promote_writer(새 세대, 누가)`(advisory lock·대기 DB 거절·하나씩만)
- **앱** — `server-kit` Db 가 `WRITER_EPOCH` 를 트랜잭션마다 `SET LOCAL` 로 넘긴다(PgBouncer 트랜잭션 풀링). 트랜잭션 밖 쓰기 문장(INSERT·UPDATE·DELETE·WITH…)도 짧은 트랜잭션으로 감싼다. 거절되면 503 재시도 안내
- **승격 순서** — `pg_promote()` → 새 Primary 에서 `promote_writer(세대+1)` → `WRITER_EPOCH` 배포. 그 사이 쓰기는 멈춘다(안전한 쪽). 운영은 `require_token` 을 켠다
- **시험** — 실제 DB 5개(세대 일치 쓰기, 승격 뒤 옛 세대 거절·읽기 그대로, 돌아온 옛 Primary 거절, 승격 잠금·건너뛰기 거절·앱 역할 불가, require_token). require_token 시험은 커밋하지 않는 트랜잭션 안에서만 켠다(동시에 도는 다른 시험이 보지 않게)
- **남은 것** — 차트 `database.writerEpoch` 운영값과 `require_token` 켜기, [DR 런북 실행 초안](18-pilot-execution-package.md#3-t-m6-08--sev13-운영-런북)의 기관 승인·실훈련. 노션(D-76)

### T-M5-62 ✅ (2026-10-03) — 복구 검증 자동화

> **2026-10-05 다시 돌림** — 첫 실행이 `pg_restore` 외래키 오류로 멈췄다: CI 재현 DB 에 시험이 남긴 **원서 없는 대조 예외 4건**(정기 대조가 시험 원서에 만든 것, 시험 정리 `breakGlass` 가 이 표의 고아 행을 치우지 않았다). 복구가 멈추니 권한 부여 단계가 빠져 제약 검사도 연쇄 실패했다. `breakGlass` 가 대조 예외 고아 행도 치우게 고친 뒤 **11개 모두 통과**(복구본 DB 제약 25종 PASS — 0011 권한 변경 기록 포함, 표 31개 행 수·체크섬 일치)

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

### 외부 PITR·DR 완료 판정

실훈련 뒤에는 `deploy/pilot/dr-acceptance.example.yaml` 사본에 원격 소산·목표 시각 PITR·부하 중 Failover·Failback·사후 대조 증적을 채우고 다음을 실행한다.

```powershell
npm run ops:dr-acceptance -- --file=deploy/pilot/<대학>-dr.yaml
```

`scripts/ops/dr-acceptance.mjs`는 입력한 RTO/RPO를 믿는 대신 장애·복구·마지막 WAL 시각으로 다시 계산한다. RTO 900초·RPO 60초 이내, HA 사전 점검 13/13, 복구 검증 skip 0, Writer epoch +1과 옛 Writer 거절, Failback, 유실·중복·미복구·대조 예외 0을 모두 요구한다. 빈 양식은 의도적으로 실패한다. 자세한 절차는 [Pilot 실행 패키지 §8.3](18-pilot-execution-package.md#83-t-m4-06t-m5-606164--pitrdr-수용-게이트)이다.

### T-M6-02 ✅ (2026-10-03) — Config 호환 시험 (D-77)

- 설정 자체 검사(Config Linter)·위험도 Diff 는 있었다(D-59). 빠져 있던 것은 **진행 중 원서와의 호환** — 줄인 최대 글자 수·바뀐 형식·새 필수 항목이 이미 쓴 원서를 깨는지
- **`modules/config/config-compat.ts`** — 적용 직전 이 주기의 진행 중 원서를 새 양식(런타임과 같은 Ajv)으로 검사. 작성 중은 저장된 값만, 검증 끝·결제 중·결제 완료는 필수까지. 하나라도 깨지면 **적용 거절**, 승인 화면(Diff)에 미리 경고(전형·항목 경로·건수)
- **시험** — 실제 DB 4개(맞는 설정 통과, 최대 글자 수 축소·형식 변경 감지, 새 필수 항목은 검증 끝 원서만)

## 경보 대응표

대시보드 「K-Admission · 운영 신호 (경보 근거)」(`dashboards/operations-signals.json`)가 같은 지표를 기준선과 함께 보여 준다.

**실제 Prometheus 확인(2026-10-05, 축소 환경)** — 화면 시험 env 로 대학 API 를 띄우고 Prometheus v3.15.0 컨테이너가 그 `/metrics` 를 수집하게 했다: 규칙 36개(기록 14·경보 22) 모두 오류 없이 평가, 운영 신호 대시보드 쿼리 10개 모두 성공. 기동 직후 `ScheduledJobStale` 이 대기(pending)였다가 결제 재확인(30초)·대조·Outbox 보관·멱등 정리(첫 확인 5분)가 실제로 돌아 `scheduled_job_run` 에 남자 모두 풀렸다(경보 지속 30분보다 먼저). 상호 TLS 가 없는 개발 환경이라 `CredentialExpiryUnknown` 은 대기 — 예상대로.

규칙 원본은 [`deploy/platform/observability/expiry-rules.yaml`](../deploy/platform/observability/expiry-rules.yaml)(이름과 달리 모든 경보), 시험은 `tests/alert-rules.test.yaml` — `npm run check:alert-rules` 가 이 표가 규칙(이름·심각도·지속·안내 문구)과 같은지도 본다(경보를 더하면 `node scripts/render-alert-runbook.mjs`). `{namespace}` 등은 경보 이름표. 심각도의 "호출" 은 `page: "true"`. 수치 기준은 설계서 상수·앱 설정을 그대로 쓰고 새로 만들지 않았다(D-93).

<!-- alert-table:start — node scripts/render-alert-runbook.mjs 가 다시 쓴다 -->
| 경보 | 심각도 | 지속 | 안내(먼저 볼 것) |
|---|---|---|---|
| `CredentialExpiresIn30Days` | info | 10m | {kind}/{name} 가 30일 안에 끝난다 — 교체 일정을 잡는다 |
| `CredentialExpiresIn14Days` | warning | 10m | {kind}/{name} 가 14일 안에 끝난다 |
| `CredentialExpiresIn7Days` | warning | 10m | {kind}/{name} 가 7일 안에 끝난다 — 교체 훈련 절차로 바꾼다 |
| `CredentialExpiresIn3Days` | critical | 5m | {kind}/{name} 가 3일 안에 끝난다 |
| `CredentialExpiresIn1Day` | critical·호출 | 1m | {kind}/{name} 가 하루 안에 끝난다 — 지금 바꾼다 |
| `WorkloadCertificateNotRenewed` | critical·호출 | 5m | {name} 의 워크로드 인증서가 갱신되지 않는다 — Vault PKI·네트워크를 본다 |
| `DbCredentialNotRotated` | critical·호출 | 2m | {name} 의 DB 동적 계정이 교체되지 않는다 — 곧 DB 연결이 끊긴다 |
| `CredentialExpiryUnknown` | warning | 30m | 플랫폼 CA 만료 지표가 없다 — 만료 경보가 꺼진 것과 같다 |
| `AuditWormMismatch` | critical·호출 | 1m | {namespace} {log} 기록이 WORM 조각과 다르다({kind}) — 감사 기록 변조 대응(보안 담당·문서 19) |
| `AuditWormVerifyStale` | warning | 30m | {namespace} WORM 대조가 주기의 두 배가 넘도록 끝나지 않았다 — 버킷 접근·대학 API 리더를 본다 |
| `ScheduledJobStale` | warning | 30m | {namespace} 주기 작업 {task} 이 주기의 두 배가 넘도록 끝나지 않았다 — 대학 API 로그의 실패 원인·DB 연결을 본다 |
| `CentralSyncLagging` | warning | 5m | {namespace} 중앙이 모르는 가장 오래된 이벤트가 기준보다 오래됐다 — 접수는 계속된다. 중앙 연결·Relay·DEAD 이벤트를 본다 |
| `OutboxDeadEvents` | warning | 5m | {namespace} 재시도를 멈춘 Outbox 이벤트가 있다 — 중앙이 모르는 변경이다. 운영 콘솔 「대조 · 예외」의 「통합 조회 전송을 포기한 알림」과 Relay 로그로 원인을 본다 |
| `PaymentGatewayCircuitOpen` | critical | 5m | {namespace} 결제사 연결 회로가 열려 결제 확인이 멈췄다 — 결제는 확인 대기로 남고 대조가 넘겨받는다. 결제사 상태·출구를 본다 |
| `DependencyCircuitOpen` | warning | 10m | {namespace} {dependency} 회로가 열려 있다 — 그 의존성으로 가는 연결·상태를 본다(중앙 회로면 접수는 계속된다, 접수 API 회로면 서류 검사가 멈춘다) |
| `DocumentScanStalled` | critical | 15m | {namespace} 검사 대기 서류가 있는데 검사가 끝나지 않는다 — 서류 워커 로그(대상 조회·결과 보고)·검사 엔진을 본다 |
| `ScanEngineUnavailable` | critical | 5m | {namespace} 서류 검사 엔진({engine})에 닿지 못한다 — 올린 서류가 검사 대기로 남는다. 검사 엔진 상태·서명 DB 를 본다 |
| `ClockOffsetExceeded` | critical | 2m | {namespace} {pod} 의 시계가 DB 와 1초 넘게 어긋나 이 Pod 는 접수를 확정하지 않는다 — 노드 NTP·DB 시계를 본다 |
| `FieldKeyUnavailable` | critical | 1m | {namespace} 필드 암호 키를 쓰지 못해({reason}) 원서·공통원서를 읽지 못한다 — 키 묶음·Vault Transit 상태와 키 교체 이력을 본다(decrypt-failed 는 암호문 변조도 의심) |
| `IssuerKeysUnavailable` | critical | 5m | {namespace} {audience} 토큰을 판단하지 못해 거절하고 있다 — 발급자(로그인 서버) 연결·공개키를 본다 |
| `IssuerOutageGraceInUse` | warning | 5m | {namespace} {audience} 만료 토큰을 단절 유예로 받고 있다 — 발급자(로그인 서버)에 닿지 않는다 |
| `EgressDenied` | warning | 1m | {namespace} 허용 목록 밖으로 나가려는 연결을 막았다({reason}) — 새 의존 주소의 출구 등록 누락인지, 사용자 입력 주소로 나가려 한 것(SSRF)인지 로그를 본다 |
| `InternalAuthRejected` | warning | 1m | {namespace} 내부 경로 요청을 거절했다({result}) — 워크로드 인증서 만료·대학 신원 불일치, 또는 위장 발신 시도를 본다 |
| `VaultRequestsFailing` | warning | 5m | {namespace} Vault {path_kind} 요청이 실패한다({result}) — Vault 상태·정책·로그인 수단을 본다(denied 는 정책 문제) |
| `FieldPlaintextReads` | info | 1h | {namespace} 암호화 전 평문 원서 값이 아직 읽힌다 — field-keys encrypt-legacy 로 옮긴다 |
| `AccessGrantSyncStale` | warning | 10m | {namespace} 권한 변경 기록 수집이 주기의 세 배(최소 3시간)가 넘도록 성공하지 못했다 — 관리 이벤트(세부 포함)가 꺼졌거나 수집 클라이언트·DB 연결을 본다 |
| `AccessGrantSyncFailing` | warning | 5m | {namespace} 권한 변경 기록 수집 Job 이 실패했다 — 종료 코드 1 은 관리 이벤트 꺼짐 또는 해시 체인 끊김 |
<!-- alert-table:end -->