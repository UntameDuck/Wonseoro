# ADR-0001. 백엔드 런타임을 NestJS + TypeScript로 한다

- 상태: 채택 (2026-09-22)
- 관련: 기술설계서 v1.0 §4 권장 기술 스택

## 맥락
기술설계서는 백엔드 기준 기술을 "Java LTS + Spring Boot 계열"로 적었다. 근거는 장기지원, 트랜잭션·관측성·보안 생태계였다.
그러나 실제 개발 인력은 2인이며, 확인된 역량은 Node/TypeScript(Next.js, Node.js, Express, Prisma, PostgreSQL)에 집중되어 있다.
로컬 JDK도 1.8로, 설계서가 요구하는 LTS 기준에 미달한다.

## 결정
백엔드를 **NestJS + TypeScript (Node LTS)** 로 구현한다.

## 근거
설계서가 실제로 요구하는 것은 언어가 아니라 네 가지 속성이다.

| 설계서 요구 | NestJS + PostgreSQL 충족 방식 |
|---|---|
| ACID 트랜잭션 / Row Lock | PostgreSQL 트랜잭션 + `SELECT ... FOR UPDATE` / 조건부 UPDATE |
| Transactional Outbox | 동일 트랜잭션 내 `outbox_event` INSERT |
| 관측성 | OpenTelemetry Node SDK (설계서와 동일한 vendor-neutral 스택) |
| 장기지원 런타임 | Node.js LTS (30개월 지원) |

추가로 프론트엔드와 타입·검증 스키마·OpenAPI 생성기를 공유할 수 있어 2인 팀 속도에서 이득이 크다.

## 대가
- Java 대비 CPU 바운드 처리량이 낮다 → Finalize는 DB 제약이 병목이므로 영향이 제한적이나, M4 부하시험에서 반드시 실측한다.
- 공공 조달 문서에서 Java를 관행적으로 기대할 수 있다 → 기술적 동등성을 이 ADR로 설명한다.

## 후속 조치
- 개발보고서 및 제출 문서의 "Java LTS + Spring Boot" 문구를 "LTS 런타임 + 엔터프라이즈 프레임워크(NestJS/Node LTS)"로 정정한다. (T-0)
- 기술설계서 §4 표를 동일하게 갱신한다.
