-- ============================================================================
-- 0006 — deadline_policy 에 수명주기를 준다 (D-23 확정, 2026-09-27)
--
-- ⚠️ 0002 와 같은 임시 파일이다. 노션 §02 첨부 DDL 에 접어 넣은 뒤 지운다.
--
-- 전에는 DDL 이 approved_by_1/2 · approved_at 을 NOT NULL 로 잡아 초안을 표현할 수 없었다.
-- 그래서 승인자 칸에 'DRAFT:' 접두사를 넣어 "아직 승인 없음" 을 나타냈다. 문자열 규약이라
-- DB 가 강제하지 못하고, 조회할 때마다 접두사를 벗겨야 했다. created_at 도 없어 이력을
-- 승인 시각으로 정렬했다 — 승인 전 초안은 정렬 기준이 아예 없었다.
--
-- 상태는 DRAFT → APPROVED → ACTIVATED 셋이다. config_version 처럼 ACTIVE/RETIRED 를 두지
-- 않는 이유: 마감 정책의 효력은 activated_at 순서로 정해진다(예약 활성화가 있다).
-- "지금 ACTIVE 인 것" 을 행에 적어 두려면 예약 시각이 올 때마다 누군가 행을 고쳐야 하고,
-- 그 누군가가 멈추면 적힌 상태가 거짓이 된다. 효력은 계속 activated_at 으로 계산한다.
--
-- created_by 도 컬럼으로 올린다. 작성자 자기승인을 DB 가 막게 된다 — config_version 과 같은
-- 수준이다 (D-21). 전에는 immutable_snapshot 안에만 있어 코드만 막았다.
-- ============================================================================

SET search_path TO kadmission, public;

BEGIN;

ALTER TABLE deadline_policy
  ADD COLUMN status varchar(24) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'ACTIVATED')),
  ADD COLUMN created_by varchar(128) NULL,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ALTER COLUMN approved_by_1 DROP NOT NULL,
  ALTER COLUMN approved_by_2 DROP NOT NULL,
  ALTER COLUMN approved_at DROP NOT NULL;

-- ── 기존 행 옮기기 ────────────────────────────────────────────────────────
-- 접두사로 적어 둔 "승인 없음" 을 NULL 로. 초안의 approved_at 은 생성 시각이었다 — 승인 시각이 아니다.
UPDATE deadline_policy SET approved_by_1 = NULL WHERE approved_by_1 LIKE 'DRAFT:%';
UPDATE deadline_policy SET approved_by_2 = NULL WHERE approved_by_2 LIKE 'DRAFT:%';

UPDATE deadline_policy
   SET created_by = COALESCE(immutable_snapshot->>'createdBy', 'unknown'),
       created_at = COALESCE((immutable_snapshot->>'createdAt')::timestamptz, approved_at, now()),
       status = CASE
                  WHEN activated_at IS NOT NULL THEN 'ACTIVATED'
                  WHEN approved_by_1 IS NOT NULL AND approved_by_2 IS NOT NULL THEN 'APPROVED'
                  ELSE 'DRAFT'
                END;

UPDATE deadline_policy SET approved_at = NULL WHERE status = 'DRAFT';

ALTER TABLE deadline_policy ALTER COLUMN created_by SET NOT NULL;

-- ── 접두사 규약에 기대던 제약을 컬럼 규칙으로 바꾼다 ─────────────────────
ALTER TABLE deadline_policy DROP CONSTRAINT deadline_policy_two_person_approval;

-- 승인된 정책은 서로 다른 두 사람이 승인했다. (0001 의 approved_by_1 <> approved_by_2 는 그대로 둔다)
ALTER TABLE deadline_policy
  ADD CONSTRAINT deadline_policy_two_person_approval CHECK (
    status = 'DRAFT'
    OR (approved_by_1 IS NOT NULL AND approved_by_2 IS NOT NULL
        AND approved_by_1 <> approved_by_2 AND approved_at IS NOT NULL)
  ),
  -- 적용 시각은 ACTIVATED 에만 있다. 초안이 적용 시각을 가질 수 없다.
  ADD CONSTRAINT deadline_policy_activation_state CHECK (
    (status = 'ACTIVATED') = (activated_at IS NOT NULL)
  ),
  -- 작성자는 자기 정책을 승인할 수 없다. (§A14, D-21 과 같은 규칙)
  ADD CONSTRAINT deadline_policy_no_self_approval CHECK (
    (approved_by_1 IS NULL OR approved_by_1 <> created_by)
    AND (approved_by_2 IS NULL OR approved_by_2 <> created_by)
  );

COMMIT;
