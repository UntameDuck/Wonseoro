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
