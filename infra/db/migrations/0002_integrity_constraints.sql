-- 0002 정합성 제약 추가 — 불일치 대장 D-21 · D-25
--
-- ⚠️ 0001_init.sql 은 노션 첨부 DDL 과 바이트 단위로 같아야 한다. 그래서 이 파일은
--    테이블을 다시 정의하지 않고 **제약만 덧붙인다.** 원본을 둘로 가르지 않기 위해서다.
--    노션 §02 에 반영된 뒤 canonical DDL 안으로 접어 넣고 이 파일은 지운다.
--    (docs/01-notion-sync-protocol.md P3)
--
-- 여기 있는 규칙은 전부 애플리케이션 코드에도 이미 있다. 그런데도 DB 에 다시 박는 이유는,
-- 코드를 우회하는 경로가 실제로 존재하기 때문이다 — 운영 중 psql, 마이그레이션 스크립트,
-- 앞으로 붙을 다른 서비스. 마감 시각과 접수 기회가 걸린 값은 마지막 방어선이 DB 여야 한다.

SET search_path TO kadmission, public;

-- ── D-21 ─────────────────────────────────────────────────────────────────────
-- config_version 은 status 에 'ACTIVE' 를 두면서도 승인자에 대한 제약이 없었다.
-- 즉 승인 0명으로 ACTIVE 가 가능했다. 원서 양식과 전형료가 거기 들어 있다.

-- 효력이 있는 상태(APPROVED·ACTIVE)는 서로 다른 두 명의 승인을 요구한다.
-- DRAFT 와 RETIRED 는 제외한다 — 승인 없이 버려진 초안을 막을 이유는 없다.
ALTER TABLE config_version
  ADD CONSTRAINT config_version_two_person_approval CHECK (
    status NOT IN ('APPROVED','ACTIVE')
    OR (approved_by_1 IS NOT NULL
        AND approved_by_2 IS NOT NULL
        AND approved_by_1 <> approved_by_2)
  );

-- 작성자는 자기 변경을 승인할 수 없다. (v1.1 §A14)
-- 이걸 허용하면 2인 승인이 형식만 남는다.
ALTER TABLE config_version
  ADD CONSTRAINT config_version_approver_not_creator CHECK (
    (approved_by_1 IS NULL OR approved_by_1 <> created_by)
    AND (approved_by_2 IS NULL OR approved_by_2 <> created_by)
  );

-- ACTIVE 인데 활성화 시각이 없으면 "언제부터 적용됐는가"에 답할 수 없다.
ALTER TABLE config_version
  ADD CONSTRAINT config_version_active_has_timestamp CHECK (
    status <> 'ACTIVE' OR activated_at IS NOT NULL
  );

-- 한 전형에 ACTIVE 설정은 하나뿐이다.
-- 둘이면 어느 양식이 적용되는지가 조회 순서에 달리게 된다.
CREATE UNIQUE INDEX uq_config_active_per_cycle
  ON config_version(cycle_id) WHERE status = 'ACTIVE';

-- deadline_policy 도 같은 구멍이 있다. 이쪽이 더 위험하다 — 마감 시각 자체다.
-- DDL 이 approved_by_1/2 를 NOT NULL 로 잡아 초안을 'DRAFT:' 접두사로 표현하고 있다.
-- (D-23) 그래서 "승인 없음"을 NULL 이 아니라 접두사로 판별한다.
ALTER TABLE deadline_policy
  ADD CONSTRAINT deadline_policy_two_person_approval CHECK (
    activated_at IS NULL
    OR (approved_by_1 NOT LIKE 'DRAFT:%'
        AND approved_by_2 NOT LIKE 'DRAFT:%'
        AND approved_by_1 <> approved_by_2)
  );

-- ── D-25 ─────────────────────────────────────────────────────────────────────
-- 대조는 주기적으로 돈다. 같은 불일치가 매 실행마다 쌓이면 큐를 읽을 수 없고,
-- 읽을 수 없는 큐는 없는 큐다. 코드에서 먼저 조회해 막고 있었으나
-- 그건 read-check-write 라 동시 실행에서 뚫린다.
CREATE UNIQUE INDEX uq_recon_open_per_type
  ON reconciliation_exception(application_id, exception_type)
  WHERE state IN ('OPEN','MANUAL_REVIEW');
