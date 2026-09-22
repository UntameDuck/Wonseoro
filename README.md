<p align="center">
  <a href="#overview">
    <img src="./docs/assets/readme-banner.png" alt="Wonseoro" width="100%" />
  </a>
</p>

<p align="center">
  <strong>표준과 편의는 하나로, 장애와 접수 책임은 대학별로.</strong><br />
  <sub>K-PaaS 기반 분산형 대학입학 원서접수 표준 플랫폼</sub>
</p>

<p align="center">
  <a href="#overview"><strong>Overview</strong></a> ·
  <a href="#architecture"><strong>Architecture</strong></a> ·
  <a href="#reliability--security"><strong>Reliability &amp; Security</strong></a> ·
  <a href="#roadmap"><strong>Roadmap</strong></a>
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/Status-Design_%26_MVP-2563EB?style=flat-square" />
  <img alt="K-PaaS" src="https://img.shields.io/badge/Platform-K--PaaS-0F766E?style=flat-square" />
  <img alt="Kubernetes" src="https://img.shields.io/badge/Runtime-Kubernetes-326CE5?style=flat-square&amp;logo=kubernetes&amp;logoColor=white" />
  <img alt="KRDS" src="https://img.shields.io/badge/UI-KRDS-4F46E5?style=flat-square" />
  <img alt="Team" src="https://img.shields.io/badge/Team-21st_ARK-111827?style=flat-square" />
</p>

## Overview

**원서로(Wonseoro)** 는 대학입학 원서접수의 편의성은 통합하되, 접수에 필요한 핵심 트래픽과 원본 데이터를 대학별 독립 환경으로 분산하는 **Federated Admission Platform**입니다. 기술 설계명은 **K-Admission**입니다.

기존의 단일 중앙 접수 구조에서는 하나의 장애가 여러 대학의 마감 업무로 전파될 수 있습니다. 원서로는 공통원서, 대학 검색, 통합 상태 조회 같은 편의 기능은 중앙에서 제공하면서도 자동저장, 대학별 추가정보, 서류, 결제 검증, 최종 접수와 접수번호 발급은 대학별 K-PaaS Data Plane에서 처리합니다.

> **Architecture Statement**  
> Compute는 대학에, Control은 중앙에, Standard는 공통 규격에, 개인정보 원본은 대학 경계 안에 둡니다.

### 해결하려는 문제

| 문제 | 원서로의 접근 |
| --- | --- |
| 마감 직전 트래픽이 한곳에 집중 | Write 트래픽과 최종 접수를 대학별 Data Plane으로 분산 |
| 중앙 장애가 여러 대학으로 확산 | 중앙 Control Plane을 접수 Critical Path에서 제외 |
| 결제 성공과 접수 상태가 모호 | Payment와 Submission 상태를 분리하고 서버가 PG 결과를 재검증 |
| 장애 이후 접수 의사 확인이 어려움 | 저장·결제·제출 전 과정을 불변 Audit Timeline으로 기록 |
| 대학별 인프라·운영역량 차이 | Self-Hosted부터 Fully Managed Dedicated까지 동일한 격리 원칙 제공 |
| 중앙 개인정보 집중 | 필요한 필드만 동의 기반으로 대학에 Snapshot 전달 |

## Design Principles

| 원칙 | 설계 기준 |
| --- | --- |
| **대학별 장애 격리** | 한 대학의 장애가 다른 대학의 접수에 전파되지 않습니다. |
| **중앙 비의존성** | 중앙이 중단돼도 이미 시작된 대학 원서의 작성·결제·접수는 계속됩니다. |
| **대학 DB 원장** | 최종 접수 여부의 System of Record는 각 대학 Data Plane의 DB입니다. |
| **표준화된 실행환경** | K-PaaS/Kubernetes, OCI, Helm, GitOps로 설치 차이를 줄입니다. |
| **Privacy by Design** | 원서 본문과 고위험 개인정보는 원칙적으로 대학 경계를 벗어나지 않습니다. |
| **Fail-safe Finalization** | 재시도에도 중복 접수가 발생하지 않고 모든 중요 상태 변경을 증명할 수 있어야 합니다. |
| **Web First** | 별도 플러그인 없이 표준 브라우저와 접근성 기준을 통해 전체 절차를 완료합니다. |

## Architecture

```mermaid
flowchart TB
    U[지원자 브라우저] --> E[CDN · DDoS · WAF]
    E --> R[대학 라우팅]

    R --> A[A대 K-PaaS<br/>Data Plane]
    R --> B[B대 K-PaaS<br/>Data Plane]
    R --> C[C대 K-PaaS<br/>Data Plane]

    CP[Central Control Plane<br/>표준 · 배포 · 관제 · 집계]

    A -->|최소 이벤트 비동기 동기화| CP
    B -->|최소 이벤트 비동기 동기화| CP
    C -->|최소 이벤트 비동기 동기화| CP

    CP -.->|Signed GitOps Release| A
    CP -.->|Signed GitOps Release| B
    CP -.->|Signed GitOps Release| C
```

### Central Control Plane

중앙은 지원자 요청의 Critical Path에 들어가지 않습니다.

- 대학·도메인·전형연도를 관리하는 University Registry
- Data/Event Schema와 호환성을 관리하는 Schema Registry
- 서명된 이미지, Helm Chart, SBOM을 관리하는 Release Registry
- 대학별 정책과 설정을 Pull 방식으로 전달하는 GitOps Control
- 최소화된 최종접수 이벤트를 검증·중복 제거하는 Sync Gateway
- 개인정보를 제거한 SLO, 보안 신호, DR 상태를 통합하는 관제 계층

### University Data Plane

각 대학은 독립된 Runtime, DB, Storage와 장애 경계를 유지합니다.

```mermaid
flowchart LR
    I[Ingress] --> API[Admission API]
    API --> APP[Application Service]
    API --> DOC[Document Service]
    API --> PAY[Payment Adapter]
    API --> FIN[Finalization Service]

    APP --> DB[(PostgreSQL HA)]
    FIN --> DB
    DOC --> OBJ[(Object Storage)]
    PAY --> PG[University PG]

    FIN --> OUT[(Transactional Outbox)]
    OUT --> RELAY[Event Relay]
    RELAY --> CP[Central Sync Gateway]
```

## Applicant Journey

지원자에게는 인프라가 분산되어 있다는 복잡성을 노출하지 않습니다.

```text
공통정보 작성
  → 대학·전형 선택
  → 대학별 추가정보·서류
  → 최종 원서 검토
  → 전형료 결제 및 자동 접수 완료
  → 접수번호·접수증 확인
```

- 입력 내용은 자동 저장되고 마지막 저장 시각과 실패 여부를 항상 표시합니다.
- 마감시간은 브라우저 시간이 아닌 서버 시간을 기준으로 판단합니다.
- 오류가 발생해도 유효한 입력값은 보존하며, 색상뿐 아니라 텍스트와 아이콘으로 상태를 전달합니다.
- 키보드만으로 전체 접수를 완료할 수 있도록 KWCAG 2.2와 KRDS 기반 UI를 목표로 합니다.

## Finalization

최종 접수는 가장 강한 정합성이 필요한 경로입니다. 중앙 동기화, 접수증 PDF, 문자·메일 발송은 대학 DB Commit 이후 비동기로 처리합니다.

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> READY: validation passed
    READY --> PAYMENT_PENDING
    PAYMENT_PENDING --> PAID: PG verified
    PAID --> FINALIZING
    FINALIZING --> FINALIZED: DB commit
    FINALIZING --> PAID: retryable failure
    DRAFT --> EXPIRED: deadline
    READY --> EXPIRED: deadline
```

최종화 Transaction은 다음 순서를 따릅니다.

1. `Idempotency-Key`와 서버 기준 마감시간을 검증합니다.
2. 지원자, 전형, 필수 필드와 서류 상태를 검사합니다.
3. 브라우저 응답이 아닌 PG 서버 조회로 결제 상태를 재검증합니다.
4. Application Row Lock 또는 조건부 Update로 동시 요청을 제어합니다.
5. `FINALIZED` 상태, 접수번호, 감사기록과 Outbox Event를 하나의 Transaction으로 확정합니다.
6. Commit 이후에만 사용자에게 접수 완료를 응답합니다.

## Service Modules

| 모듈 | 역할 |
| --- | --- |
| Applicant Web | 공통원서, 전형 선택, 자동저장, 서류, 결제, 접수상태 UX |
| Admission API | Schema·권한 검증, ETag/Optimistic Lock, 표준 Error Model |
| Application Service | Draft와 대학별 추가필드, 마감·전형 유효성 검증 |
| Document Service | Presigned Upload, 파일 검증, 악성코드 격리, 권한 기반 다운로드 |
| Payment Adapter | 대학별 PG 연계, Webhook 서명 검증, 재조회와 정산 |
| Finalization Service | 멱등성, 접수원장 확정, 접수번호와 Outbox 생성 |
| Event Relay | At-least-once 전달, 재시도, Dead Letter, 중앙 ACK 처리 |
| Control Plane | 표준·정책·Release·관제·최소 이벤트 집계 |

## Technology

| Layer | Baseline |
| --- | --- |
| Platform | K-PaaS Container Platform / Kubernetes |
| Deployment | OCI Image · Helm · GitOps |
| Frontend | React · TypeScript · KRDS Component Kit |
| Backend | Java LTS · Spring Boot |
| Data | PostgreSQL HA · Redis HA · S3-compatible Object Storage |
| Security | Vault/KMS/HSM · mTLS · NetworkPolicy · Signed Image |
| Registry | Harbor 또는 동등한 OCI Registry |
| Observability | OpenTelemetry · Prometheus · Grafana · OpenSearch/Loki |
| Contracts | OpenAPI 3.x · CloudEvents · JSON Schema |

특정 제품은 구현 기본안입니다. 실제 도입에서는 기관의 보안정책과 인증 요건을 만족하는 동등 제품으로 대체할 수 있으며, 플랫폼 표준은 제품명이 아니라 인터페이스와 정책으로 정의합니다.

## Reliability & Security

### 운영 목표

아래 수치는 설계 기준이자 Pilot 인수 목표이며, 아직 운영 실적을 의미하지 않습니다.

| 지표 | 목표 |
| --- | ---: |
| 일반 접수기간 Availability | 99.95% 이상 |
| 마감일 마지막 6시간 Availability | 99.99% |
| Draft Save p95 | 500 ms 이하 |
| Read API p95 | 300 ms 이하 |
| Finalization DB 처리 p95 | 1.5초 이하, 외부 PG 지연 제외 |
| 대학 Data Plane RTO | 15분 이내 |
| 최종접수 핵심 DB RPO | 0~1분 이내 |

### Pilot 검증 시나리오

| 시험 | 인수 방향 |
| --- | --- |
| 중앙 2시간 단절 | 대학 접수 지속, 원서 손실 0건 |
| 동일 Finalize 100회 재시도 | Submission 1건만 생성 |
| PG Callback 30분 지연 | Polling/Reconciliation으로 자동 정합화 |
| DB Failover | 중복 접수 0건, 확정 상태 복원 |
| 3,000 CCU + 1,000 RPS Burst | 사전 확장 후 핵심 Endpoint SLO 충족 |
| 마감·전형료 설정 변경 | 2인 승인과 버전 없이는 Production 반영 불가 |

### Security Baseline

- 외부 TLS와 서비스 간 mTLS, Kubernetes `default-deny` NetworkPolicy
- 대학 담당자 OIDC SSO + MFA, 역할·목적 기반 최소권한
- DB, Backup, Object Storage 암호화와 고위험 필드 별도 암호화/Tokenization
- Secret Scan → SAST/SCA → SBOM → Container/IaC Scan → DAST → Image Signing
- 서명되지 않은 이미지를 차단하는 Admission Policy
- 애플리케이션 DB와 분리된 위변조 방지 Audit 저장소
- Metrics, Trace, Log에 원서 본문과 직접식별정보를 남기지 않는 공통 Masking 정책

## Deployment Models

| 모델 | 운영 주체 | 대학별 경계 | 적용 상황 |
| --- | --- | --- | --- |
| Self-Hosted | 대학 | 대학 IDC/Cloud 전용 Data Plane | 자체 인프라·운영 조직 보유 |
| Co-Managed | 대학 + 원서로 | 대학 계정의 독립 환경 | 공동 관제와 Peak 운영지원 필요 |
| Fully Managed Dedicated | 원서로 | 대학별 전용 Runtime·DB·Storage | 운영인력이 부족하지만 전용 환경이 필요한 대학 |

어떤 모델에서도 여러 대학의 접수 Runtime이나 원본 DB를 하나로 합치지 않습니다. **운영은 통합할 수 있지만 접수 Runtime과 데이터는 통합하지 않습니다.**

## Roadmap

### Phase 1 — Standard Prototype

- K-Admission Schema v1
- KRDS 기반 Applicant Web
- Application/Draft/Finalization
- PostgreSQL + Transactional Outbox
- Central Sync Gateway와 K-PaaS Helm Chart

### Phase 2 — Security & Payment

- PG Adapter와 Reconciliation
- Vault/KMS, mTLS, RBAC/MFA
- Audit/WORM과 CI/CD Security Gate

### Phase 3 — Production Reliability

- Multi-AZ DB와 DR
- 중앙 관제와 마감일 Peak Mode
- Chaos, Load, Failover, DR Test
- 2~3개 대학 독립 Data Plane Pilot

### Phase 4 — National Scale

- 대학 Onboarding 자동화
- 공통원서 및 교육기관 연계 Adapter
- Schema Governance와 다중 CSP Profile
- 연간 보안·감사·DR 증적 자동화

## Planned Repository Layout

```text
k-admission/
├── platform/                 # 공통 정책, 관측성, K-PaaS 기반 구성
├── apps/
│   ├── applicant-web/        # 지원자 Web
│   ├── admission-api/        # 공개 API Gateway
│   ├── application-service/  # 원서 상태와 검증
│   ├── document-service/     # 서류 업로드와 검사
│   ├── payment-adapter/      # 대학별 PG Adapter
│   └── event-relay/          # 중앙 비동기 동기화
├── schemas/                  # OpenAPI, JSON Schema, CloudEvents
├── charts/                   # Helm Chart
├── universities/             # 대학별 Values와 정책
└── docs/                     # ADR, Threat Model, Runbook
```

## Project Status

현재 저장소는 **설계 정리 및 MVP 준비 단계**입니다. 아키텍처, 데이터·API 계약, 배포·보안·장애검증 기준을 구현 단위로 구체화하고 있으며, 실행 가능한 코드와 배포 구성이 공개되는 시점에 설치, 로컬 개발, 테스트, 기여 방법을 순차적으로 추가할 예정입니다.

이 문서의 성능·가용성 수치는 목표값이며 검증 결과가 아닙니다. 법률·보안·공공 클라우드 기준은 2026-09-17 설계 기준선을 바탕으로 정리했으며, 실제 도입 전 각 대학의 법적 지위와 시스템 등급에 따른 보안성 검토, 개인정보 영향평가, 법무 검토가 필요합니다.

## Team

**21st ARK**는 최근 대학입시 원서접수를 직접 경험한 2인의 학생 개발팀입니다.

| 역할 | 담당 |
| --- | --- |
| Product · Architecture · Backend · Security | 사업모델, 대학 Data Plane, Application/Payment/Submission, 데이터·API 계약, K-PaaS, 감사·DR |
| Frontend · Full-stack · Platform Operations | Applicant Web, Common Profile, Dashboard, 중앙 편의계층, API 연동, 배포·관측성 자동화 |
| 공동 | End-to-End 통합, 부하·장애·복구 시험, 사용자 검증, 대학 Pilot 요구사항 반영 |

## References

- [K-Admission 기술설계서](https://efficient-rook-e79.notion.site/K-Admission-K-PaaS-3de75ab5debe801f99c5fee017130c65)
- [Wonseoro GitHub Repository](https://github.com/UntameDuck/Wonseoro)
- 2026년 GovTech 창업경진대회 제품·서비스 개발 분야 제출본

---

<p align="center">
  <strong>WONSEORO · K-ADMISSION</strong><br />
  <sub>하나의 서비스처럼 편리하게, 하나의 시스템에는 의존하지 않게.</sub>
</p>
