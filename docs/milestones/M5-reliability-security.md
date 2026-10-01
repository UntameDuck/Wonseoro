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

> **T-M5-08 착수 (2026-09-30, D-58)** — magic-byte 검사는 M1 부터 있다. AV 는 ClamAV(clamd INSTREAM) 어댑터·서명 URL 다운로드·해시 대조·엔진 버전 기록까지 구현하고
> 같은 프로토콜의 가짜 clamd 로 시험했다(서류 워커 시험 8개). **남은 것: 실 clamd·서명 DB 로 확인**(이미지 내려받기 필요), Zip Bomb·매크로 문서 판정 확인, clamd 배치.

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

### 화면 제품화 (권민준)

> **2026-10-01 추가.** 지금 화면에는 개발자가 개발자에게 하는 말이 섞여 있다. 설계·구조 설명, 설계 문서 번호, 내부 코드·버전, 개발용 입력, 검증기 영문 원문이 그런 예다.
> 이것을 걷어내고 운영 수준으로 올린다. **디자인(배치·색·컴포넌트)은 바꾸지 않는다** — 글·표기·빠진 상태, 그리고 노션 첨부 와이어프레임과 다른 점만 다룬다.
> 두 앱·KRDS 부품·화면에 뜨는 서버 문구를 전수 점검해 59개 항목(U-1 ~ U-59)을 찾았다. 항목별 위치·현재 문구·바꿀 방향, 결정 16개, 회귀 방지 검사는
> **[08-ui-production-readiness.md](../08-ui-production-readiness.md)** 에 있다. 접근성(T-M5-40~47)과 같은 파일을 만지니 함께 한다.

| ID | 태스크 | 항목 | 인수기준 |
|---|---|---|---|
| T-M5-50 | 설계·구조 설명과 설계 문서 번호를 화면에서 걷어낸다 ✅ 2026-10-01 | U-12·17·32·36·39·44·46·52·54 | 화면 문자열에 `§`·`D-N`·`T-Mx`·`v1.x`·"기술설계서"가 0개, "중앙·원본" 같은 구조 설명이 0개. 소스 문구 검사(`scripts/check-ui-copy.mjs`)가 CI 에서 통과 |
| T-M5-51 | 내부 코드·식별자·버전 대신 사람 말로 보인다 | U-7·10·19·22·23·24·29·31·37·40·42·43·45·48·49·50·53 | 지원자 화면에 영문 대문자 코드·UUID·버전 문자열이 0개, 콘솔은 사람 말이 앞에 온다. 사람 말 사전은 `@wonseoro/contracts` 한 곳에 두고, 사전에 빠진 값이 있으면 시험이 실패한다. 계약 변경 둘(U-7 접수 이벤트 표시 이름·U-22 동의 대학 이름)은 노션 첨부 교체를 함께 한다 |
| T-M5-52 | 오류·검증 문구를 지원자·담당자 말로 바꾼다 | U-1·2·25·26·28·41 | 계약의 오류 code 전부에 화면 문구가 있다(빠지면 시험 실패). 검증 문구는 서버가 한국어와 항목 이름으로 만든다. 화면에 영문 오류·HTTP 번호가 0개. 오류 요약 항목을 누르면 그 칸으로 간다 |
| T-M5-53 | 개발용 신원 입력을 개발 모드에 가둔다 ✅ 2026-10-01 | U-20·21·38 | 개발 서버(`next dev`)에서만 그린다(`NEXT_PUBLIC_DEV_IDENTITY=0`·`ADMIN_DEV_OPERATOR=0` 으로 끈다). 운영 빌드에 1 을 주면 빌드가 멈춘다(R8 과 같은 방식). 시드 값이 화면 문구에 없다. **완료** — 운영 번들에 시드 값 0곳, 운영 콘솔은 담당자 쿠키 무시·지정 403 ([08 「진행」](../08-ui-production-readiness.md#진행)) |
| T-M5-54 | 날짜·시각·이름·아이콘 표기를 통일한다 | U-4·15·16·18·47 | 두 앱이 표기 함수 하나(`@wonseoro/krds`)를 쓰고, 표기는 와이어프레임 형식(`2026.12.31 18:00`)이다. 콘솔 마감 입력은 한국 시간으로 고정한다. 이모지 아이콘이 0개 |
| T-M5-55 | 불러오는 중·없음·오류 상태와 기본 페이지를 갖춘다 | U-8·9·13·14·33·34·35·59 | 모든 조회 화면이 세 상태를 나눈다. 한국어 404·오류 화면이 있다. 화면마다 제목이 있다. 접수증 인쇄에 메뉴·버튼이 없다. 오래 걸리는 요청은 안내한다 |
| T-M5-56 | 흐름 결함과 와이어프레임 차이를 고친다 | U-3·5·6·11·27·30·51(선택)·55·56·57·58 | 각 항목 해소 → 화면 27장을 다시 찍고 렌더링 문구 검사(`capture.mjs --check-copy`)를 통과한다 |

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
- [ ] 화면에 설계 설명·설계 문서 번호·내부 코드·개발용 안내가 없다 — 소스·렌더링 문구 검사 통과, U-1~U-59 해소 ([08](../08-ui-production-readiness.md))
- [ ] DR 전환 훈련 RTO/RPO 목표 달성
- [ ] **노션 §06·§09를 다시 읽고** 실제 적용 결과 반영
- [ ] 새로 식별된 위협을 §09 STRIDE register에 추가
- [ ] 대학 법적 지위별(국공립 / 사립) 적용범위를 v1.0 §18 Profile에 반영
- [ ] 발견한 불일치를 D-N으로 등록·처리
