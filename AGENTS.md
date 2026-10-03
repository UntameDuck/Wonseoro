# AGENTS.md — AI 작업자 안내

이 저장소를 이어받는 AI(또는 사람)는 **[docs/HANDOFF.md](docs/HANDOFF.md) 를 먼저 읽는다.**
지킬 규칙(§2), 이 PC 환경의 함정(§3), 다음 작업과 실행 방법(§4)이 거기 있다.

요점만:

- 문서·커밋·보고는 **한국어**. 커밋에 AI 공동저자 줄을 넣지 않는다
- 노션 기술설계서가 설계 원본이다. 어긋나면 먼저 `docs/02-spec-discrepancy-register.md` 에 `D-N` 으로 올린다
- 노션 첨부 사본(`deploy/charts/k-admission/values-m.yaml`, `deploy/platform/policies/*`, `tests/load/k6-admission.js`, `docs/spec-assets/*`, `infra/db/migrations/0001_init.sql`, `packages/contracts/openapi/k-admission.v1.yaml`, `packages/contracts/events/*.json`)은 노션과 바이트가 같아야 한다
- 노션 페이지 수정은 페이지마다 사용자 확인. **AI 의 노션 쓰기는 권한 분류기가 막는다** — 변경안은 `docs/06-notion-changeset.md` 로 준비한다. 지금 첨부 5종은 저장소가 노션보다 앞선다
- runtime 첨부(`deploy/platform/policies/runtime.yaml`)는 차트 렌더링 결과다 — 손으로 고치지 말고 `node scripts/render-runtime-attachment.mjs`
- 로컬 수치는 "축소 환경" 으로 명시, 수치를 지어내지 않는다
- 지금 할 일: `docs/03-next-steps.md` 「완성까지 남은 단계」 — A 목록(AI 가 이 PC 에서 끝낼 23개)을 권장 순서대로. 화면 제품화 T-M5-50~56·접근성 T-M5-40~46·보안 파이프라인 T-M5-20~29는 끝났다 — 지금은 인증(로컬 OIDC, T-M5-02·10·T-M3-06 — 단계 1~8 끝, 다음 단계 9 화면 시험 다시, `docs/12`)(2026-10-01~02, `docs/08`·`docs/09`·`docs/11`, 47 은 실물 Firefox·Safari 만 사람)
- 화면을 고치면 접근성 시험(`tests/a11y/`, `docs/09-accessibility.md`)을 다시 돌린다 — 화면이 바뀌어 누른 버튼이 사라지면 포커스를 옮길 자리를 정하고(`Card titleId`·`Alert focusKey`), 나중에 나타나는 안내는 `LiveRegion` 안에 둔다. 매초 바뀌는 글을 알림 영역에 넣지 않는다
- 화면에 보이는 글에 설계 설명·설계 문서 번호(`§`·`D-N`·`T-M`)·내부 코드·개발용 안내를 넣지 않는다 — 근거는 코드 주석에 둔다. `npm run check:ui-copy` 가 CI 에서 막는다. 상태·코드의 화면 이름은 `packages/contracts/src/labels.ts`, 오류 문구는 `problem-text.ts`, 날짜·시각은 `@wonseoro/krds` 의 `formatDateTime`, 아이콘은 `<Icon>` 을 쓴다. 서버 오류 문장에도 필드 이름·헤더 이름·상태 코드를 쓰지 않는다
- 같은 폴더에서 다른 세션이 일할 수 있다 — 커밋 전 `git log`·`git status` 확인, 문서는 통째로 덮어쓰지 않는다
