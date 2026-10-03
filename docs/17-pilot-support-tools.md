# Pilot 지원 도구 구현·인계

> 최종 갱신: 2026-10-04 · 작업 폴더 기준 · T-M6-01·06 완료, T-M6-07 미착수

사용자 요청에 따라 사용량이 약 10% 남으면 새 작업을 시작하지 않기로 했다. 2026-10-04 기준 사용량 11%에서 멈췄으며, 아래 변경은 검증을 마쳤지만 아직 커밋하지 않았다. 임시 웹/API 프로세스는 종료했다. 화면 시험용 PostgreSQL 컨테이너 `ui-shots-pg`는 실행 중일 수 있다.

## T-M6-01 전형 Schema 온보딩 — 완료

- 관리자 설정 화면에서 빈 Config 또는 적용 중 Config로 시작해 전형·문항·공통원서 연결·제출 서류를 구조적으로 편집한다.
- 구조화 편집기는 기존 고급 JSON과 같은 Config를 만들며, 알 수 없는 기존 키를 보존한다. 고급 JSON 편집 경로도 그대로 남겼다.
- 화면 선검사 뒤 기존 서버 Config Linter, 2인 승인, T-M6-02 호환 시험으로 이어진다.
- 주요 파일: `apps/admin-web/src/components/config-onboarding.tsx`, `apps/admin-web/src/lib/config-onboarding.ts`, `apps/admin-web/src/app/api/public/admission-types/route.ts`.
- 검증: 관리자 운영 빌드, 화면 문구 검사, Chrome 1280/320 각 9화면·Tab 153/157자리·문제 0.

## T-M6-06 상태 페이지·대학별 장애 배너 — 완료

설계 결정은 [D-78](02-spec-discrepancy-register.md)에 있다. 공지는 중앙이 아니라 각 대학 Data Plane이 소유한다. 중앙 장애와 별개로 대학 API가 살아 있는 동안 상태 안내가 유지되고, 공개 응답에는 지원자 안내만 담는다.

- 저장: `infra/db/migrations/0007_service_incident.sql`. 추가 전용 원장이고 `ACTIVE → RESOLVED`만 허용한다. 삭제·본문 수정 권한은 없다. Writer fence도 적용한다.
- 공개 API: `GET /api/v1/meta/service-status`.
- 운영 API: `GET/POST /admin/v1/incidents`, `POST /admin/v1/incidents/{incidentId}/resolve`. operator 범위, Step-up, 멱등 키, 감사 이벤트가 필요하다.
- 지원자 화면: 전역 배너와 `/status`. 30초마다 대학 상태를 갱신한다.
- 관리자 화면: `/status`에서 공지 발행·목록·해제.
- 계약: OpenAPI 1.8.0, 감사 동작 `INCIDENT_PUBLISHED`·`INCIDENT_RESOLVED`.

확인한 결과:

- DB 마이그레이션 적용 및 제약·권한 검증 22종 PASS.
- incident 통합 시험 2/2 PASS.
- admission-api 전체 382개: 379 pass, 3 skip, 0 fail.
- admin-web·frontend 운영 빌드 PASS, `npm run check:contracts` PASS(1.8.0, 58 operations), `npm run check:ui-copy` PASS(187 files).
- 상태 화면 접근성: Chrome 1280/320 각각 2화면·Tab 19자리·문제 0.
- 관리자 전체 접근성: Chrome 1280/320 각각 10화면·Tab 176/180자리·문제 0.
- 브라우저에서 발행 → 전역 배너/상태 페이지 → 해제 → 정상 복귀를 확인했고, 활성 시험 공지는 남기지 않았다.

결과 파일은 `tests/a11y/results/`의 다음 네 파일이다.

- `focus-sweep-status-chrome-1280-2026-10-03T15-12-50-355Z.json`
- `focus-sweep-status-chrome-320-2026-10-03T15-13-02-841Z.json`
- `focus-sweep-admin-chrome-1280-2026-10-03T15-13-20-868Z.json`
- `focus-sweep-admin-chrome-320-2026-10-03T15-14-07-087Z.json`

## T-M6-07 PII 최소 Support View — 다음 작업, 미착수

설계·코드·DB 변경을 시작하지 않았다. 이어받는 작업자는 먼저 노션 §01 B11을 다시 읽고 다음 항목이 충분히 정해졌는지 확인한다. 부족하면 구현 전에 [불일치 대장](02-spec-discrepancy-register.md)에 D-79 결정을 새로 만든다.

반드시 지킬 경계:

- 상담원은 원서 항목 값(`application_field_value`), 공통원서, 첨부파일, 이름·연락처를 보지 못한다.
- 허용 후보는 원서 처리 상태, 단계별 처리 시각, 결제/서류의 개인정보 없는 요약, 중앙 동기화 안내, 자동 생성 증적번호다. **후보일 뿐 아직 계약으로 확정하지 않았다.**
- 상담 전용 역할과 기존 operator/security-auditor 중 어느 범위를 쓸지, 원서 찾기에 사용할 개인정보 없는 조회 키, 증적번호 형식·보존 위치를 먼저 결정한다.
- API 응답 자체에서 금지 필드를 제거한다. 화면에서 숨기는 것만으로 끝내지 않는다. BOLA·대학 경계·감사 기록 시험을 둔다.
- 화면에는 내부 코드·UUID·설계 번호를 그대로 보이지 않는다. 완료 뒤 `npm run check:ui-copy`와 관리자 Chrome 1280/320 접근성 시험을 다시 실행한다.

권장 진행 순서:

1. `AGENTS.md`, `docs/HANDOFF.md`, 노션 §01 B11, 이 문서를 읽는다.
2. 역할·조회 키·허용 응답·증적번호 규칙을 확정하고 필요하면 D-79 및 `docs/06-notion-changeset.md`를 먼저 갱신한다.
3. OpenAPI 계약과 보안/소유권 시험을 먼저 작성한다.
4. admission-api의 최소 응답 서비스와 관리자 BFF/화면을 구현한다.
5. 실 DB 통합 시험, 두 앱 빌드, 계약·문구 검사, 관리자 1280/320 접근성 검사를 실행한다.
6. 이 문서, `HANDOFF`, `03-next-steps`, M6 마일스톤, 불일치 대장, 노션 changeset을 함께 갱신한다.

## 재검증 명령

PowerShell에서 저장소 루트 기준:

```powershell
npm run check:contracts
npm run check:ui-copy
npm --workspace apps/admission-api run typecheck
npm --workspace apps/admin-web run build
npm --workspace apps/frontend run build
git diff --check
```

DB 포함 admission-api 전체 시험은 기존 `ui-shots-pg` 또는 CI 재현 DB의 접속 환경을 맞춘 뒤 실행한다. 컨테이너와 포트 운용법은 [HANDOFF](HANDOFF.md)와 `scripts/screenshots/prepare.sh`를 따른다. 기존 미추적 결과 파일과 `tests/ops/`는 다른 작업 흔적일 수 있으므로 정리하거나 커밋에 섞기 전에 반드시 `git status`로 소유 범위를 확인한다.
