-- 0003 서명된 활성화 기록 — T-M3-14·15, 불일치 대장 D-35
--
-- ⚠️ 0002 와 같은 원칙이다. canonical DDL(0001)의 테이블을 고치지 않고 **새 테이블만 더한다.**
--    노션 §02 에 반영된 뒤 canonical DDL 안으로 접어 넣고 이 파일은 지운다.
--
-- 왜 필요한가 (v1.1 §B17 · §A1 · §A14)
--   마감을 연장하면 "누가 언제 왜 연장했는지" 가 불변 기록으로 남아야 한다.
--   그런데 deadline_policy · config_version 에는 **활성화한 사람도, 사유도, 서명도** 담을
--   자리가 없다. 활성화 시각 하나만 있다. 되돌리기(rollback)는 같은 행의 activated_at 을
--   덮어쓰므로, 두 번째 활성화가 첫 번째 활성화의 기록을 지운다.
--
--   그래서 활성화 **사건**을 별도 행으로 남긴다. 정책·설정 행은 "무엇" 이고,
--   이 행은 "언제·누가·왜 그것을 적용했는가" 다. 사건마다 한 행이다.
--
-- 서명
--   payload(정규화한 JSON)에 Ed25519 서명을 붙인다. 공개키는 공개한다.
--   대학 밖(중앙·감사인)에서도 이 대학이 적용한 마감 정책이 승인된 그대로인지
--   DB 접근 없이 확인할 수 있다 — 중앙이 끊겨도 대학이 들고 있는 "서명된 Local Policy
--   Snapshot" 이 이것이다. (§A1)

SET search_path TO kadmission, public;

CREATE TABLE IF NOT EXISTS activation_record (
  id uuid PRIMARY KEY,
  cycle_id uuid NOT NULL REFERENCES admission_cycle(id),
  subject_type varchar(24) NOT NULL CHECK (subject_type IN ('DEADLINE_POLICY','CONFIG_VERSION')),
  subject_id uuid NOT NULL,
  subject_version varchar(64) NOT NULL,
  kind varchar(16) NOT NULL CHECK (kind IN ('ACTIVATE','EXTEND','ROLLBACK')),
  -- 효력 시각. 예약 활성화면 미래일 수 있다.
  effective_at timestamptz NOT NULL,
  operator_id varchar(128) NOT NULL,
  reason text,
  -- 입학처 결정 문서번호. 연장은 필수다 — 기술팀이 결정하지 않는다. (§B17)
  decision_ref varchar(128),
  -- 이 활성화로 밀려난 버전. 처음이면 NULL
  supersedes_version varchar(64),
  payload jsonb NOT NULL,
  payload_hash varchar(128) NOT NULL,
  signature text NOT NULL,
  key_id varchar(64) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  -- 연장·되돌리기는 사유 없이 기록될 수 없다.
  CHECK (kind = 'ACTIVATE' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)),
  CHECK (kind <> 'EXTEND' OR (decision_ref IS NOT NULL AND length(btrim(decision_ref)) > 0))
);

CREATE INDEX IF NOT EXISTS idx_activation_subject
  ON activation_record(subject_type, subject_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_activation_cycle
  ON activation_record(cycle_id, recorded_at);

-- ── append-only ──────────────────────────────────────────────────────────────
-- 고칠 수 있는 기록은 불변 기록이 아니다. 애플리케이션에는 UPDATE·DELETE 경로가 없지만,
-- 운영 중 psql 같은 우회 경로가 실제로 존재한다. (§B16) DB 가 마지막 방어선이다.
--
-- 서명만으로는 "지워진 것" 을 잡지 못한다. 서명은 남은 행이 진짜인지만 말해준다.
-- 그래서 지우는 것 자체를 막는다. (WORM 저장소 분리는 M5)
CREATE OR REPLACE FUNCTION activation_record_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activation_record 는 추가만 가능하다 (% 거부)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activation_record_no_update ON activation_record;
CREATE TRIGGER activation_record_no_update
  BEFORE UPDATE OR DELETE ON activation_record
  FOR EACH ROW EXECUTE FUNCTION activation_record_append_only();

-- TRUNCATE 는 행 트리거를 거치지 않는다. 따로 막는다.
DROP TRIGGER IF EXISTS activation_record_no_truncate ON activation_record;
CREATE TRIGGER activation_record_no_truncate
  BEFORE TRUNCATE ON activation_record
  FOR EACH STATEMENT EXECUTE FUNCTION activation_record_append_only();
