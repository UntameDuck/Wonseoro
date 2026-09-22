# M0 — 기반 구축

| | |
|---|---|
| **목표** | 두 사람이 각자 개발을 시작할 수 있는 저장소·계약·로컬 인프라를 세운다 |
| **완료 기준** | `npm install` → `npm run dev:infra` → `admission-api`·`central-api` `/healthz` 200 |
| **선행 조건** | 없음 |
| **상태** | 🟡 진행 중 (T-M0-06, T-M0-07 남음) |

## 노션 확인 대상

착수 전·종료 시 아래를 읽는다.

- [v1.0 본문](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) §3 목표 아키텍처, §4 기술 스택, §13 배포·변경관리
- [v1.1 §05 Helm·GitOps](https://app.notion.com/p/3df75ab5debe811cac32ec1c98d50d59) — 저장소 디렉터리 구조
- [v1.1 §10 역할 분리](https://app.notion.com/p/3df75ab5debe8143b651d8aef608a0a5) — 어떤 기능이 어느 Plane인지

## 태스크

| ID | 태스크 | 담당 | 근거 노션 | 인수기준 | 상태 |
|---|---|---|---|---|---|
| T-M0-01 | 모노레포 구조 + npm workspaces | 공동 | v1.1 §05 | `apps/` 5개, `packages/contracts`, `deploy/` 생성 | ✅ |
| T-M0-02 | git 초기화 · `.gitignore` · `.gitattributes` | 권민준 | — | 커밋 author가 팀 계정으로 고정 | ✅ |
| T-M0-03 | `packages/contracts` 골격 | 공동 | v1.0 §5.6·§9, v1.1 §04 | 상태머신·결제·감사·이벤트·Problem 타입 정의 | ✅ |
| T-M0-04 | 로컬 Compose 스택 | 권민준 | v1.0 §4 | postgres(대학/중앙 분리)·redis·minio 기동 | ✅ |
| T-M0-05 | CI 골격 (앱별 독립 잡) | 권민준 | v1.0 §13.1 | contracts/backend/frontend 잡 분리 | ✅ |
| T-M0-06 | **설계서 첨부 8종 배치** | 송리안 | 전 문서 | `docs/spec-assets/README.md` 10행 전부 ✅ | ⬜ |
| T-M0-07 | `npm install` + 헬스체크 확인 | 권민준 | — | 두 API `/healthz` 200 | ✅ |
| T-M0-08 | 제출 PDF "Java LTS" 문구 정정 | 송리안 | ADR-0001, D-3 | 정정본 확보 | ⬜ |

## 태스크 상세

### T-M0-06 — 설계서 첨부 8종 배치 ⚠️ M1 선행

**왜 중요한가**: DDL·OpenAPI·CloudEvents Schema는 노션 첨부가 canonical이다.
배치 전에 저장소에서 같은 내용을 새로 쓰면 설계 원본이 둘로 갈라진다 (v1.1 §A5·§A16).

**할 일**
1. 노션 각 문서에서 첨부파일 다운로드 (API로는 받을 수 없다 — D-5)
2. `docs/spec-assets/README.md`의 배치 경로표대로 저장
3. 배치 후 확인:
   - `0001_init.sql` → `infra/db/README.md`의 정합성 제약 5종이 실제로 들어갔는지
   - `k-admission.v1.yaml` → §03의 Applicant/Admin/Internal 엔드포인트가 전부 있는지
   - `k-admission-cloudevents.schema.json` → 이벤트 타입이 `kr.kadmission.*` 인지 (D-1)
4. 배치표의 상태 열을 ✅로 갱신하고 커밋

**노션 확인 포인트**: 첨부파일이 본문 설명과 어긋나면 **첨부가 이긴다.** 어긋난 부분은 D-N으로 대장에 등록한다.

### T-M0-08 — 제출 PDF 문구 정정

ADR-0001의 기술적 동등성 논거를 그대로 쓴다. Java를 못 해서가 아니라, 설계서가 요구하는 4가지 속성을 Node LTS + PostgreSQL이 충족하기 때문이라는 논리로 서술한다.

## 종료 체크리스트

- [~] 첨부 배치 3/10 (DDL·OpenAPI·CloudEvents 완료. 나머지 7종은 M4/M5 착수 전까지)
- [x] `npm install` → `/healthz` 200 확인
- [ ] 노션 v1.0 §4 기술 스택 표 Backend 행 수정 (D-3)
- [ ] 불일치 대장 D-1·D-2·D-3·D-4의 "노션 반영" 열 처리
- [ ] 두 사람이 각자 로컬에서 동일하게 기동되는지 교차 확인
