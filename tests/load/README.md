# 부하·장애·복구 테스트 (M4)

근거: 기술설계서 v1.1 §08. `k6-admission.js`가 canonical skeleton이다. **아직 미배치.**

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
