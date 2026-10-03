-- 0004 DB 비상 접속 — 역할·기록 (T-M5-03, docs/13 단계 5)
--
-- 노션 §02 첨부 DDL 밖 — 저장소가 더한다(대장 D-72).
-- 장애 때 사람이 DB 에 직접 들어가야 할 수 있다. 그 길을 평소 계정(소유자·슈퍼유저 비밀번호)으로 두지 않는다:
--   - Vault 가 비상 그룹에게만 수명 15분짜리 DB 계정을 준다(database/creds/break-glass-<대학>, scripts/vault/dev-vault.mjs)
--   - 그 계정은 kadmission_break_glass 역할을 물려받는다 — 업무 표 읽기·고치기. DDL·역할 변경·감사 기록 수정은 없다
--   - 계정을 만들 때 Vault 가 break_glass_access 에 한 줄 남긴다(추가만, 고치거나 지울 수 없다) — 누가 언제까지 들어올 수 있었는지
--   - 그 계정의 모든 문장은 서버 로그에 남는다(log_statement = all, Vault 생성문이 계정마다 건다)
-- 다시 돌려도 된다.

SET search_path TO kadmission, public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_break_glass') THEN
    CREATE ROLE kadmission_break_glass NOLOGIN;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS break_glass_access (
  id bigserial PRIMARY KEY,
  db_user varchar(128) NOT NULL,
  valid_until timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION break_glass_access_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'break_glass_access 는 추가만 가능하다 (% 거부)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS break_glass_access_no_update ON break_glass_access;
CREATE TRIGGER break_glass_access_no_update BEFORE UPDATE OR DELETE ON break_glass_access
  FOR EACH ROW EXECUTE FUNCTION break_glass_access_append_only();
DROP TRIGGER IF EXISTS break_glass_access_no_truncate ON break_glass_access;
CREATE TRIGGER break_glass_access_no_truncate BEFORE TRUNCATE ON break_glass_access
  FOR EACH STATEMENT EXECUTE FUNCTION break_glass_access_append_only();

GRANT USAGE ON SCHEMA kadmission TO kadmission_break_glass;
-- 업무 표 — 장애 복구에 필요한 읽기·고치기. 감사 기록은 0002 의 트리거가 계정과 관계없이 막는다
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA kadmission TO kadmission_break_glass;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA kadmission TO kadmission_break_glass;
-- 비상 접속 기록 자체는 읽기만
REVOKE ALL ON break_glass_access FROM kadmission_break_glass;
GRANT SELECT ON break_glass_access TO kadmission_break_glass;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER TABLE break_glass_access OWNER TO kadmission_migrator;
    ALTER FUNCTION break_glass_access_append_only() OWNER TO kadmission_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_app') THEN
    -- 앱은 이 표를 쓰지 않는다 — 0002 기본 권한으로 붙은 것을 걷는다
    REVOKE ALL ON break_glass_access FROM kadmission_app;
    REVOKE ALL ON SEQUENCE break_glass_access_id_seq FROM kadmission_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_auditor') THEN
    GRANT SELECT ON break_glass_access TO kadmission_auditor;
  END IF;
END $$;
