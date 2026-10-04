# Pilot 진입 증적 파일

`pilot-readiness.example.yaml`은 T-M6-08·09·10·12·13·15와 M6 종료 조건을 한 번에 확인하는 빈 양식이다. 이 파일 자체는 모든 상태가 `pending`이라 반드시 실패한다. 실제 대학·전형별로 복사해 기관이 승인하거나 실제로 실행한 결과만 채운다.

```powershell
Copy-Item deploy/pilot/pilot-readiness.example.yaml deploy/pilot/<대학>-<전형>.yaml
npm run ops:pilot-readiness -- --file=deploy/pilot/<대학>-<전형>.yaml
```

판정기는 다음을 요구한다.

- SEV1~3 런북 기관 승인과 7개 역할의 주·대체 담당 및 비상 연락망 참조
- D-180~D+30 운영주기 9구간의 완료 증적
- War-room 5개 상황 주입의 관찰 결과
- 개인정보 영향평가 대상 여부와 개인정보 담당자 승인
- 노션 §16 필수 시험 18종의 환경·시각·건너뜀 수·결과
- 노션 §19 Compliance 10개 영역의 적합/비대상 판정과 근거
- Sandbox→Shadow→제한 Pilot 3단계 기관 승인과 피드백 처리

증적은 저장소 경로, 읽기 권한이 통제된 문서 URL, 티켓 번호, 모니터링 스냅숏 ID처럼 나중에 다시 열 수 있는 참조를 넣는다. 비밀번호·토큰·개인 연락처·지원자 정보는 YAML이나 결과 JSON에 넣지 않는다. 연락처는 Vault 또는 기관 비상연락망의 항목 참조만 쓴다.

판정 결과는 `tests/ops/results/pilot-readiness-<대학>-<시각>.json`에 남고, 하나라도 빠지면 종료 코드 1이다. 사람이 `passed: true`로 직접 적는 칸은 없다.

실행 절차와 각 증적의 의미는 [Pilot 운영·검증 실행 패키지](../../docs/18-pilot-execution-package.md)를 따른다.

## 실 PG Sandbox 수용 증적

`pg-sandbox-acceptance.example.yaml`은 T-M6-04·05를 실제 계약 계정에서 닫기 위한 별도 양식이다. PG 사업자와 어댑터가 정해진 뒤 대학별로 복사한다.

```powershell
Copy-Item deploy/pilot/pg-sandbox-acceptance.example.yaml deploy/pilot/<대학>-pg-sandbox.yaml
npm run ops:pg-sandbox-acceptance -- --file=deploy/pilot/<대학>-pg-sandbox.yaml
```

결제 9종과 정산 5종이 모두 실제 `pg-sandbox`에서 통과하고 건너뜀이 0건이어야 한다. `mock-pg`는 거절한다. 거래번호·가맹점 번호는 원문으로 남기지 않고, 정렬한 식별자 집합의 소문자 SHA-256만 `transactionSetHash`·`merchantAccountRefHash`에 기록한다. 비밀키·콜백 비밀·토큰은 어떤 경우에도 Git에 넣지 않는다.

빈 예시는 결제 0/9·정산 0/5로 실패하는 것이 정상이다. 성공 결과가 생겨도 담당자가 원시 PG 장부·애플리케이션 감사 기록·정산 예외를 표본 대조한 뒤에만 M6 태스크를 완료 처리한다.

## CSP Edge·노드 장애 수용 증적

`edge-failover-acceptance.example.yaml`은 로컬에서 끝내지 못한 T-M4-39의 실제 Edge 판정 양식이다. 관리형 Edge/Gateway와 서로 다른 zone이 두 곳 이상 있는 CSP staging에서만 쓴다.

```powershell
Copy-Item deploy/pilot/edge-failover-acceptance.example.yaml deploy/pilot/<대학>-edge-failover.yaml
npm run ops:edge-failover-acceptance -- --file=deploy/pilot/<대학>-edge-failover.yaml
```

게이트는 안전 메서드 재시도, 멱등 키가 있는 쓰기만 재시도, 능동 헬스체크, 계획 정비와 노드 강제 손실 2개 시나리오를 확인한다. 강제 손실에서는 Edge 재시도가 실제로 1건 이상 관찰되어야 하며 사용자 체감 실패·중복 쓰기·중복 접수·이중 승인·미복구 이벤트 공백은 모두 0이어야 한다. 로컬·kind, 건너뜀, 승인 목표보다 긴 복구는 통과하지 않는다.

## PostgreSQL PITR·DR 수용 증적

`dr-acceptance.example.yaml`은 T-M4-06·T-M5-60·61·64의 실제 CSP 실행 양식이다. `ops:ha-preflight` 13/13 통과 뒤, DB와 다른 장애영역의 기본 백업·WAL에서 목표 시각 PITR을 만들고 승인된 부하 중 Failover·Failback을 수행해 채운다.

```powershell
Copy-Item deploy/pilot/dr-acceptance.example.yaml deploy/pilot/<대학>-dr.yaml
npm run ops:dr-acceptance -- --file=deploy/pilot/<대학>-dr.yaml
```

게이트는 사건 시각에서 RTO·RPO를 다시 계산해 각각 15분·1분을 넘으면 실패시킨다. Writer 세대가 정확히 1 증가하고 옛 Writer가 거절되는지, DNS/Edge 전환과 현재 Writer 기준 Failback이 끝났는지, 복구 검증 건너뜀이 0인지, 유실·중복·미복구 순번·대조 예외가 모두 0인지도 요구한다. 로컬 덤프 복구는 이 양식의 대체 증적이 아니다.

## 외부 M Profile 부하 캠페인 종료

`load-campaign.example.yaml`은 개별 `ops:load-acceptance` 결과 5개를 하나의 승인 캠페인으로 묶는 양식이다. 결과 파일을 직접 다시 읽으므로 사람이 프로필 성공 여부나 실행시간을 옮겨 적지 않는다.

```powershell
Copy-Item deploy/pilot/load-campaign.example.yaml deploy/pilot/<대학>-load-campaign.yaml
npm run ops:load-campaign-acceptance -- --file=deploy/pilot/<대학>-load-campaign.yaml
```

500·1,500·3,000 VU+1,000 RPS·70% Failover·6시간 Soak가 같은 환경·승인 참조여야 한다. 30분 프로필은 29분, Deadline은 19분, Soak는 5시간 58분 미만이면 실패한다. Failover 결과에는 Writer 세대 판정이 필요하고, API 메모리·DB 연결·Pool 대기·Outbox 지연·중앙 지연 추세가 모두 승인 용량 안이어야 한다. D-90의 Finalize 150/300 TPS는 결정 전이라 이 캠페인 완료에 포함하지 않는다.

## 실물 브라우저·수동 접근성 수용 증적

`manual-accessibility.example.yaml`은 T-M5-47·48의 사람 실행 양식이다. 자동 브라우저나 접근성 트리 결과로 채우지 않고, 실물 Windows Firefox·iPhone Safari와 실제 보조기기에서 검사자가 관찰한 사실만 기록한다.

```powershell
Copy-Item deploy/pilot/manual-accessibility.example.yaml deploy/pilot/<대학>-manual-a11y.yaml
npm run ops:manual-accessibility-acceptance -- --file=deploy/pilot/<대학>-manual-a11y.yaml
```

두 브라우저에서 지원자 접수·OIDC 로그인·세션 경고 대화상자·키보드 포커스·200% 확대/재배치·파일 업로드 여섯 흐름을 각각 수행한다. 데스크톱/모바일 스크린리더, 200% 확대, 음성 입력도 실제 도구 이름·판·관찰 결과를 남긴다. 건너뜀·에뮬레이션·차단/중대 결함·미승인은 통과하지 않는다.
