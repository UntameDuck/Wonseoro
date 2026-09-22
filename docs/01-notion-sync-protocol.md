# 노션 설계서 동기화 규칙 (Notion Sync Protocol)

> **이 문서가 모든 마일스톤 문서보다 우선한다.**
> 노션 기술설계서는 살아 있는 문서다. 구현 중에도 계속 바뀐다.
> 코드가 노션을 앞서 나가거나, 노션이 코드를 앞서 나간 채로 방치되면
> 설계서 v1.1 `A5(대학별 커스터마이징으로 표준 붕괴)` · `A16(Breaking Change)`가 경고한 상황이 그대로 발생한다.

---

## 1. 원칙

| # | 원칙 | 의미 |
|---|---|---|
| P1 | **노션이 설계의 상위 문서다** | 아키텍처 원칙·데이터 모델·API 계약·보안정책의 원본은 노션이다 |
| P2 | **저장소가 실행의 상위 문서다** | 구현 순서·범위·일정·담당은 `docs/`가 원본이다 |
| P3 | **불일치는 숨기지 않고 대장에 올린다** | 발견 즉시 `02-spec-discrepancy-register.md`에 기록. 조용히 한쪽을 고치지 않는다 |
| P4 | **코드가 설계를 바꿨으면 노션을 고친다** | 구현하다 설계가 틀렸음을 발견하면 코드만 고치고 끝내지 않는다 |
| P5 | **첨부파일이 canonical이다** | DDL·OpenAPI·CloudEvents·Helm values·보안정책·k6·STRIDE는 노션 첨부가 원본. 저장소에서 새로 쓰지 않는다 |

---

## 2. 확인 시점 — 언제 노션을 다시 읽는가

세 가지 시점에 **반드시** 확인한다. "생각났을 때"는 시점이 아니다.

### ① 태스크 착수 전 (Pre-task Check)
각 태스크에는 `근거 노션 절`이 붙어 있다. 코드를 쓰기 전에 그 절을 다시 읽는다.
- 마지막으로 읽은 시점 이후 `page_last_edited_at`이 바뀌었는가?
- 바뀌었다면 무엇이 바뀌었는가? 내 태스크의 인수기준이 달라지는가?

### ② 태스크 완료 시 (Post-task Sync)
구현 결과가 설계와 다르면 **둘 중 하나를 반드시 한다.**
- 코드를 설계에 맞춘다, 또는
- 노션을 고치고 불일치 대장에 사유를 남긴다

"일단 이렇게 짜고 나중에 맞추자"는 금지한다. 다음 태스크가 그 위에 쌓인다.

### ③ 마일스톤 종료 시 (Milestone Gate)
해당 마일스톤의 `노션 확인 대상` 문서 전체를 다시 읽고, 마일스톤 문서 하단의 **종료 체크리스트**를 채운다.
체크리스트가 안 채워지면 다음 마일스톤에 착수하지 않는다.

---

## 3. 노션 문서 지도

| 노션 문서 | 링크 | 주로 쓰는 마일스톤 |
|---|---|---|
| 기술설계서 v1.0 (본문) | [열기](https://app.notion.com/p/3de75ab5debe801f99c5fee017130c65) | 전체 |
| v1.1 (상위 인덱스) | [열기](https://app.notion.com/p/3df75ab5debe813d9c78c64b3969a103) | 전체 |
| 01. 운영 리스크·설계 결함 | [열기](https://app.notion.com/p/3df75ab5debe813c87fceef73f0d74e8) | M1·M2·M3 |
| 02. PostgreSQL ERD | [열기](https://app.notion.com/p/3df75ab5debe81299f7cffbd769811ee) | **M1** |
| 03. OpenAPI 계약 | [열기](https://app.notion.com/p/3df75ab5debe81588b56fcd81e7b3856) | **M1·M2** |
| 04. CloudEvents Schema | [열기](https://app.notion.com/p/3df75ab5debe81d68e37fabd3678dcc4) | **M2** |
| 05. Kubernetes·Helm·GitOps | [열기](https://app.notion.com/p/3df75ab5debe811cac32ec1c98d50d59) | **M4** |
| 06. NetworkPolicy·RBAC·Vault | [열기](https://app.notion.com/p/3df75ab5debe81e0aab2e000ccdebba7) | **M5** |
| 07. KRDS 와이어프레임 | [열기](https://app.notion.com/p/3df75ab5debe812db3d1e06d0761e38e) | **M2** |
| 08. 부하·장애·복구 테스트 | [열기](https://app.notion.com/p/3df75ab5debe81edb65cf9ecaf4e2b89) | **M4** |
| 09. STRIDE 위협모델 | [열기](https://app.notion.com/p/3df75ab5debe81e4bff5f44e1e3112d4) | **M5** |
| 10. 역할 분리·트래픽 분산 | [열기](https://app.notion.com/p/3df75ab5debe8143b651d8aef608a0a5) | M2·M4 |

---

## 4. 불일치를 발견했을 때 — 처리 절차

```
불일치 발견
  ↓
① 02-spec-discrepancy-register.md 에 D-N 번호로 등록
   (어느 문서 vs 어느 문서 / 무엇이 다른가 / 발견 시점)
  ↓
② 어느 쪽이 canonical 인지 판정
   - 최신 문서가 우선 (v1.1 > v1.0 > 제출 PDF)
   - 첨부파일이 본문 설명보다 우선
   - 판단이 갈리면 두 사람이 결정하고 근거를 대장에 남긴다
  ↓
③ 패자 쪽을 고친다
   - 노션이 틀렸으면 → 노션 수정 + 대장에 "노션 갱신 완료" 표시
   - 저장소가 틀렸으면 → 코드/문서 수정
   - 제출 PDF가 틀렸으면 → 제출 전 정정 목록에 추가
  ↓
④ contracts 에 영향이 있으면 두 사람 공동 리뷰
```

**판정 우선순위**

1. 노션 첨부파일 (DDL / OpenAPI yaml / CloudEvents json / values yaml / k6 / STRIDE csv)
2. 노션 v1.1 하위 문서 (01~10)
3. 노션 v1.0 본문
4. 개발보고서 PDF

> 예: 이벤트 네임스페이스가 v1.0은 `kr.admission.*`, v1.1 §04는 `kr.kadmission.*` → **v1.1 채택**.
> 이 판정은 대장 `D-1`에 기록되어 있다.

---

## 5. 노션을 고쳐야 하는 대표 상황

구현하다 보면 아래가 반드시 나온다. 나올 때마다 노션을 고친다.

| 상황 | 예상 시점 | 고칠 노션 문서 |
|---|---|---|
| DDL 컬럼이 실제 구현과 안 맞음 | M1 | 02. ERD + 첨부 DDL |
| OpenAPI에 없는 엔드포인트가 필요해짐 | M1·M2 | 03. OpenAPI + 첨부 yaml |
| 상태머신에 전이가 하나 더 필요해짐 | M2 | v1.0 §5.6 + 02 |
| 이벤트에 필드 추가 (optional) | M2 | 04. CloudEvents + 첨부 json |
| 화면 단계가 6단계로 안 떨어짐 | M2 | 07. KRDS 와이어프레임 |
| 부하 수치가 실측과 다름 | M4 | 08 + v1.0 §10.1 Size Profile |
| Helm values 기본값 조정 | M4 | 05 + 첨부 values |
| 위협 하나가 새로 식별됨 | M5 | 09 + STRIDE register |

**optional field 추가는 호환 변경이지만, 노션 갱신은 여전히 의무다.** (v1.1 §04 Schema Evolution)

---

## 6. 기록 위치

| 무엇 | 어디에 |
|---|---|
| 불일치 대장 | `docs/02-spec-discrepancy-register.md` |
| 태스크별 노션 확인 결과 | 각 마일스톤 문서의 태스크 표 `노션 확인` 열 |
| 마일스톤 종료 확인 | 각 마일스톤 문서 하단 `종료 체크리스트` |
| 첨부파일 배치 현황 | `docs/spec-assets/README.md` |
| 설계 결정 변경 | `docs/adr/` 에 새 ADR 추가 (기존 ADR을 덮어쓰지 않는다) |

---

## 7. 하지 말 것

- ❌ 노션을 안 읽고 기억으로 구현하기 — 문서는 마지막으로 읽은 시점 이후 바뀌어 있을 수 있다
- ❌ 첨부파일 내용을 저장소에서 새로 작성하기 — 원본이 둘로 갈라진다
- ❌ 불일치를 발견하고 한쪽만 조용히 고치기 — 상대방은 다른 쪽을 보고 있다
- ❌ "나중에 노션 정리하자" — 다음 태스크가 그 위에 쌓인 뒤에는 되돌리는 비용이 몇 배가 된다
- ❌ ADR을 덮어쓰기 — 결정이 바뀌면 새 ADR을 쓰고 이전 것을 `Superseded by ADR-XXXX`로 표시한다
