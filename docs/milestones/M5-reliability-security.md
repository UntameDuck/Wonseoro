# M5 — 신뢰성 · 보안 · 접근성

| | |
|---|---|
| **목표** | 실제 대학에 넣을 수 있는 보안·접근성 수준을 만든다 |
| **완료 기준** | CI 보안 게이트 10종 통과, 키보드만으로 전체 접수 완료, DR 전환 훈련 성공 |
| **선행 조건** | M4 종료 체크리스트 완료 |
| **주 담당** | 송리안 (보안·DR) / 권민준 (접근성·CI) |

## 노션 확인 대상

| 문서 | 이 단계에서 보는 이유 |
|---|---|
| [06. NetworkPolicy·RBAC·Vault](https://app.notion.com/p/3df75ab5debe81e0aab2e000ccdebba7) | **주 설계서.** Default Deny, RBAC 6역할, Secret 계층 |
| [09. STRIDE](https://app.notion.com/p/3df75ab5debe81e4bff5f44e1e3112d4) | 위협별 대응, 고위험 Abuse Case, Security Acceptance |
| [v1.0 §8](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 보안 아키텍처, CI/CD Security Gate 10종 |
| [v1.0 §7](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 구간별 통신 규격 (TLS/mTLS) |
| [v1.0 §10.3·§12.4](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | DR 목표, 접근성 Acceptance |
| [v1.0 §2](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 적용 규정 기준선 — 대학 법적 지위에 따른 적용범위 |

## 태스크

### 보안 (송리안)

| ID | 태스크 | 근거 노션 | 인수기준 |
|---|---|---|---|
| T-M5-01 | Network Default Deny | §06 | 허용경로 6종만, 대학 간 route 금지 |
| T-M5-02 | RBAC 6역할 적용 | §06 | platform-viewer / sre-operator / admission-admin / security-auditor / release-controller / break-glass |
| T-M5-03 | Break-glass 계정 | §06, §01 A7 | 평시 disable, 짧은 TTL, 사용 즉시 경보 |
| T-M5-04 | Vault/KMS 대학별 path 분리 | §06 | DB dynamic credential, mTLS 인증서 short TTL |
| T-M5-05 | Service mTLS | v1.0 §7.1 | 내부 통신 평문 금지, Zero Trust |
| T-M5-06 | Field-level 암호화 / Tokenization | v1.0 §8.3 | 고위험 필드 별도 암호화, KEK/DEK 분리 |
| T-M5-07 | SSRF Egress Allowlist | §09 | PG·중앙·인증기관만, Metadata 차단 |
| T-M5-08 | 파일 magic-byte + AV 실연동 | §09 | Zip Bomb·실행파일·매크로 차단 |
| T-M5-09 | BOLA 방어 | §09 | Cross-user/Cross-university 객체 접근 0 |
| T-M5-10 | Admin MFA + Step-up | §06 | 민감정보 조회 시 목적·사유 입력 |

### CI 보안 게이트 (권민준) — v1.0 §8.4 10종

| ID | 게이트 | 통과 기준 |
|---|---|---|
| T-M5-20 | 1. Secret Scan | plaintext secret commit 0 |
| T-M5-21 | 2. SAST | Critical 0 |
| T-M5-22 | 3. Dependency/SCA + CVE | Critical 0 |
| T-M5-23 | 4. SBOM 생성 | 릴리스마다 첨부 |
| T-M5-24 | 5. Container Image Scan | Critical 0 |
| T-M5-25 | 6. IaC/K8s Manifest Scan | 정책 위반 0 |
| T-M5-26 | 7. Unit/Integration Security Test | 통과 |
| T-M5-27 | 8. DAST/Staging Scan | High 0 |
| T-M5-28 | 9. Image Signing | 전 이미지 서명 |
| T-M5-29 | 10. Admission Controller | **미서명 이미지 배포 거부 실증** |

### 접근성 (권민준) — v1.0 §12.4 / §07

| ID | 태스크 | 인수기준 |
|---|---|---|
| T-M5-40 | 키보드 전용 접수 완주 | 1~6단계 + 완료까지 마우스 없이 |
| T-M5-41 | Visible Focus / Focus Order | 전 화면 |
| T-M5-42 | Screen Reader 검증 | Label·Error·Step·Status 전달 |
| T-M5-43 | 200% 확대 | 기능 손실 없음 |
| T-M5-44 | 모바일 320 CSS px | 가로 스크롤 없음 |
| T-M5-45 | Session Timeout 사전 경고 | 입력 유실 전 경고 + 연장 옵션 |
| T-M5-46 | CAPTCHA 대체수단 | 접근 가능한 경로 제공 |
| T-M5-47 | 브라우저 상호운용 | Chrome/Edge/Safari/Firefox + 모바일 |
| T-M5-48 | KWCAG 2.2 자동 + **수동** 검사 | 자동만으로 끝내지 않는다 |

### DR (송리안)

| ID | 태스크 | 근거 노션 | 인수기준 |
|---|---|---|---|
| T-M5-60 | Multi-AZ Primary/Standby | v1.0 §10.3 | 동기 복제 |
| T-M5-61 | PITR + 원격지 백업 소산 | v1.0 §10.3 | 다른 장애영역 |
| T-M5-62 | **Restore Verification 자동화** | §01 B10 | 월별 자동 복구 + checksum/row-count/업무 invariant |
| T-M5-63 | Writer Fencing + Promotion Lock | §01 A10 | Split-brain 방지, 단일 Writer |
| T-M5-64 | DR 전환 훈련 | v1.0 §10.3 | RTO 15분 / RPO 0~1분 실측 |
| T-M5-65 | 인증서·Secret 만료 사전경보 | §01 B9 | 30/14/7/3/1일, rotation drill |

## 종료 체크리스트 — 노션 §09 Security Acceptance

- [ ] Cross-user / Cross-university object access 0
- [ ] Finalized 일반수정 API 없음
- [ ] Unsigned image 실행 0
- [ ] Secret plaintext Git commit 0
- [ ] Critical Config 단독승인 불가
- [ ] 운영계정 Audit 삭제 불가
- [ ] Replayed Event가 상태를 중복 변경하지 않음
- [ ] 키보드만으로 전체 접수 완료
- [ ] DR 전환 훈련 RTO/RPO 목표 달성
- [ ] **노션 §06·§09를 다시 읽고** 실제 적용 결과 반영
- [ ] 새로 식별된 위협을 §09 STRIDE register에 추가
- [ ] 대학 법적 지위별(국공립 / 사립) 적용범위를 v1.0 §18 Profile에 반영
- [ ] 발견한 불일치를 D-N으로 등록·처리
