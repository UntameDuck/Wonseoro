# 부하·장애·복구 테스트 (M4)

근거: 기술설계서 v1.1 §08. `k6-admission.js`는 노션 첨부와 바이트가 같은 canonical skeleton이라 수정하지 않는다. 실제 K-PaaS/CSP 실행은 `k6-acceptance.js`와 사후 DB 판정기(`npm run ops:load-acceptance`)를 쓴다. **아직 외부 환경에서 실행하지 않았다.**

## M Profile 기준
전체 지원 30,000건 / 설계 Peak CCU 1,500 / Stress CCU 3,000 / API Burst 1,000 RPS
Finalize 150 TPS 5분 + 300 TPS 60초

## 시나리오 12종
1. Baseline 500 VU 30분
2. Expected Peak 1,500 VU 30분
3. Deadline Flash Crowd 3,000 VU + 1,000 RPS
4. 동일 Application Finalize 100회 동시 요청
5. PG p95 10초, 5% timeout, callback 1~30분 지연
6. Central Sync 2시간 차단
7. Peak 70% 부하에서 DB Primary Failover
8. Redis Failover / Cache 초기화
9. Object Storage 지연
10. API Node 강제 종료
11. Bot/Abuse 트래픽 + 학교 NAT 정상사용자 동시
12. 6시간 Soak

## Acceptance
- Read p95 ≤ 300ms / Draft Save p95 ≤ 500ms / Finalize 내부처리 p95 ≤ 1.5s (외부 PG 제외)
- 업무 Validation 제외 Error < 0.1%
- duplicate Submission 0 / Payment double-confirm 0
- Central event loss 0 / Sequence gap 미복구 0
- Central outage 중 핵심접수 지속 / DB failover 후 자동 복구

## 외부 환경 실행 준비

> **Finalize 처리량은 아직 이 실행 묶음의 합격 항목이 아니다(D-90).** M Profile 전체 지원 30,000건과 150 TPS 5분 + 300 TPS 60초(총 63,000요청)가 충돌하고, canonical skeleton은 한 원서의 이미 접수된 응답을 실제 Finalize 처리량처럼 잰다. 첫 Finalize와 멱등 replay의 분모·지속시간을 노션 §08에서 확정하기 전에는 Finalize p95를 완료 처리하지 않는다.

### 1. 안전 경계

- 대학·CSP가 명시적으로 승인한 격리 시험 환경과 HTTPS 주소만 쓴다. `ALLOW_LOAD_TEST=true`, `LOAD_TEST_APPROVAL=<티켓>`, `TARGET_ENVIRONMENT=<환경 ID>`가 없으면 스크립트가 시작하지 않는다.
- 실 지원자·운영 결제·운영 통지 채널을 쓰지 않는다. 합성 OIDC 사용자마다 서로 다른 DRAFT 원서 하나를 미리 만든다.
- 토큰·refresh token은 저장소 밖 JSON에 둔다. 로그·요약·사후 결과에는 토큰과 원서 ID를 쓰지 않고, 원서 ID 집합의 SHA-256과 건수만 남긴다.
- 실행 창에는 다른 부하·배포·데이터 정리를 섞지 않는다. DB Failover는 승인된 HA 콘솔/런북에서 운영자가 실행하며 k6가 임의 명령을 실행하지 않는다.

### 2. 합성 사용자 파일

시험 프로필마다 최소 500/1,500/3,000/1,050명 또는 승인된 Soak 인원만큼 준비한다. 배열 순서대로 첫 N명을 쓰며 `applicationId`는 중복되면 안 된다. `savePayload`는 해당 대학의 실제 적용 Config를 통과하는 합성 값이어야 한다.

```json
[
  {
    "accessToken": "저장소 밖에서 주입",
    "expiresAt": "2027-08-20T10:00:00+09:00",
    "refreshToken": "6시간 Soak에 필요",
    "applicationId": "합성 사용자의 DRAFT 원서 UUID",
    "savePayload": {
      "fields": {
        "대학 Config에 정의된 필드": "합성 값"
      }
    }
  }
]
```

30분 시험 도중 access token이 끝나도 refresh 설정이 있으면 VU별로 갱신한다. 6시간 Soak는 `OIDC_TOKEN_ENDPOINT`(HTTPS)·`OIDC_CLIENT_ID`와 사용자별 `refreshToken`이 필수다. 기밀 client면 `OIDC_CLIENT_SECRET`도 프로세스 환경으로만 넣는다.

### 3. 프로필

| `LOAD_PROFILE` | 태스크 | 실제 구성 | 별도 운영 행동 |
|---|---|---|---|
| `baseline-500` | T-M4-30 | 5분 상승 + 500 VU 20분 + 5분 하강 | 없음 |
| `expected-1500` | T-M4-31 | 5분 상승 + 1,500 VU 20분 + 5분 하강 | 없음 |
| `deadline-3000-rps1000` | T-M4-32 | 3,000 VU 유지 구간에 정확히 한 HTTP 요청인 1,000 iteration/s Burst 5분을 겹침 | Peak Mode·대시보드 확인 |
| `failover-70` | T-M4-36 | Expected Peak의 70%인 1,050 VU, 30분 | 시작 10~15분 사이 Primary Failover, 새 writer epoch 기록 |
| `soak-6h` | T-M4-41 | 기관이 승인한 `SOAK_VUS`로 상승·유지·하강 합계 6시간 | 메모리·DB/Pool 연결·큐 추세 보존 |

### 4. 실행

아래는 PowerShell 예시다. 값은 승인 티켓의 실행계획에서 가져온다.

```powershell
New-Item -ItemType Directory -Force tests/load/results | Out-Null
$env:ALLOW_LOAD_TEST = 'true'
$env:BASE_URL = 'https://승인된-시험-주소'
$env:LOAD_PROFILE = 'baseline-500'
$env:LOAD_TEST_APPROVAL = '기관-티켓-번호'
$env:TARGET_ENVIRONMENT = 'pilot-staging-a'
$env:LOAD_USERS_FILE = 'D:\통제경로\load-users.json'
$env:SUMMARY_PATH = 'tests/load/results/raw-baseline-500.json'
k6 run tests/load/k6-acceptance.js
```

6시간 Soak는 앞 환경에 다음을 더한다.

```powershell
$env:SOAK_VUS = '기관 승인 인원'
$env:OIDC_TOKEN_ENDPOINT = 'https://시험-idp/token'
$env:OIDC_CLIENT_ID = '시험-client'
```

### 5. 사후 판정

k6 threshold만으로 완료하지 않는다. 같은 합성 사용자 파일과 읽기 가능한 대학 DB 관리자 주소로 중복 접수·결제 중복확정·FINALIZED/Submission 불일치·Outbox 순번/DEAD·열린 Reconciliation 예외를 확인한다. DB 주소는 출력하지 않는다.

```powershell
$env:DATABASE_ADMIN_URL = 'postgresql://통제된-읽기계정@HA-DB/대학DB'
npm run ops:load-acceptance -- --summary=tests/load/results/raw-baseline-500.json --users=D:\통제경로\load-users.json --profile=baseline-500
```

Failover는 실제 승격 뒤의 세대를 반드시 더한다.

```powershell
npm run ops:load-acceptance -- --summary=tests/load/results/raw-failover-70.json --users=D:\통제경로\load-users.json --profile=failover-70 --expected-writer-epoch=2
```

결과는 `tests/load/results/load-acceptance-*.json`이다. k6 필수 metric/threshold 누락, 버린 iteration 1개 이상, DB 정합성 문제 1건 이상, Failover 세대 불일치 중 하나라도 있으면 종료 코드 1이다. 인프라 메모리·커넥션 누수 추세, RTO/RPO, Edge 재시도 판정은 이 JSON에 자동으로 지어 넣지 않고 대시보드·HA 이벤트 증적을 Pilot YAML에 별도로 연결한다.
