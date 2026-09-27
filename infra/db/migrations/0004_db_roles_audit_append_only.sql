-- 0004 — DB 역할 분리 · 감사 기록 추가 전용 (D-41)
--
-- v1.0 §9 "감사로그 삭제·수정 권한을 운영자에게 부여하지 않음" · v1.1 §01 E
-- "운영계정으로 Audit 삭제 불가" · §B16 "Production interactive write 경로 없음".
--
-- 이 파일 전까지 애플리케이션은 **슈퍼유저 하나(wonseoro)** 로 붙었다. 앱이든 운영자든
-- 같은 권한으로 감사 기록을 지울 수 있었고, 통합 시험 5개 파일이 실제로 지우고 있었다.
--
-- 두 겹으로 막는다.
--   1. 권한 — 앱 역할에는 감사·적용 기록의 UPDATE·DELETE·TRUNCATE 권한 자체가 없다
--   2. 트리거 — 소유자·슈퍼유저라도 평소 경로로는 고치거나 지울 수 없다
--      (0003 에서 activation_record 에 붙인 것과 같다)
--
-- 슈퍼유저가 트리거를 일부러 끄는 것(session_replication_role=replica)은 막지 못한다.
-- 그건 DB 안에서는 막을 수 없다 — 물리 분리(WORM · Object Lock)는 M5 다.
-- 이 파일이 보장하는 것은 "평소 쓰는 계정으로는 지울 수 없다" 까지다.
--
-- 비밀번호는 여기 두지 않는다. 역할은 NOLOGIN 으로 만들고, 로그인·비밀번호는
-- 환경마다 따로 준다 (개발: infra/db/dev-roles.sql, 운영: Vault — M5).
--
-- 여러 번 실행해도 같은 결과여야 한다.

SET search_path TO kadmission, public;

-- ── 역할 ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 애플리케이션(admission-api · document-service · event-relay)이 붙는 역할
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_app') THEN
    CREATE ROLE kadmission_app NOLOGIN;
  END IF;
  -- 스키마·테이블 소유자. DDL 은 이 역할로만 한다. 앱은 DDL 을 못 한다
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    CREATE ROLE kadmission_migrator NOLOGIN;
  END IF;
  -- 감사·증적 열람. 읽기만 한다
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_auditor') THEN
    CREATE ROLE kadmission_auditor NOLOGIN;
  END IF;
END $$;

-- ── 소유권 ─────────────────────────────────────────────────────────────
-- 소유자는 GRANT 와 관계없이 자기 테이블에 뭐든 할 수 있다. 그래서 앱이 소유자면
-- 아래 권한 분리가 의미가 없다. 소유권을 migrator 로 옮긴다.
ALTER SCHEMA kadmission OWNER TO kadmission_migrator;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'kadmission' LOOP
    EXECUTE format('ALTER TABLE kadmission.%I OWNER TO kadmission_migrator', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'kadmission' LOOP
    EXECUTE format('ALTER SEQUENCE kadmission.%I OWNER TO kadmission_migrator', r.sequencename);
  END LOOP;
END $$;

-- ── 권한 ───────────────────────────────────────────────────────────────
REVOKE ALL ON SCHEMA kadmission FROM PUBLIC;
GRANT USAGE ON SCHEMA kadmission TO kadmission_app, kadmission_auditor;

-- 업무 테이블: 앱은 읽고 쓴다. TRUNCATE·DDL 은 없다
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables
            WHERE schemaname = 'kadmission'
              AND tablename NOT IN ('audit_event', 'activation_record') LOOP
    EXECUTE format('REVOKE ALL ON kadmission.%I FROM kadmission_app', r.tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON kadmission.%I TO kadmission_app', r.tablename);
  END LOOP;
END $$;

-- 감사·적용 기록: **추가와 조회만.** 고치고 지우는 권한이 애초에 없다
REVOKE ALL ON audit_event, activation_record FROM kadmission_app;
GRANT SELECT, INSERT ON audit_event, activation_record TO kadmission_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA kadmission TO kadmission_app;
GRANT SELECT ON ALL TABLES IN SCHEMA kadmission TO kadmission_auditor;

-- 앞으로 migrator 가 만드는 테이블도 같은 규칙을 따르게 한다.
-- 추가 전용 테이블을 새로 만들면 그 마이그레이션에서 UPDATE·DELETE 를 REVOKE 해야 한다 —
-- 잊으면 db:verify 15번이 잡는다.
ALTER DEFAULT PRIVILEGES FOR ROLE kadmission_migrator IN SCHEMA kadmission
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kadmission_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kadmission_migrator IN SCHEMA kadmission
  GRANT SELECT ON TABLES TO kadmission_auditor;
ALTER DEFAULT PRIVILEGES FOR ROLE kadmission_migrator IN SCHEMA kadmission
  GRANT USAGE, SELECT ON SEQUENCES TO kadmission_app;

-- ── audit_event 추가 전용 트리거 ───────────────────────────────────────
-- 권한은 역할을 잘못 쓰면 뚫린다(예: 누가 앱을 소유자 계정으로 띄움). 트리거는 계정과
-- 관계없이 선다. hash-chain 은 고친 것을 **찾아내고**, 이 트리거는 고치는 것을 **막는다.**
CREATE OR REPLACE FUNCTION audit_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event 는 추가만 가능하다 (% 거부)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION audit_event_append_only() OWNER TO kadmission_migrator;
ALTER FUNCTION activation_record_append_only() OWNER TO kadmission_migrator;

DROP TRIGGER IF EXISTS audit_event_no_update ON audit_event;
CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();

-- TRUNCATE 는 행 트리거를 거치지 않는다. 따로 막는다.
DROP TRIGGER IF EXISTS audit_event_no_truncate ON audit_event;
CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_append_only();
