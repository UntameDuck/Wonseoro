-- 0007 대학별 장애 공지 원장 (T-M6-06, 노션 §01 B11, 대장 D-78)
--
-- 중앙이 끊겨도 대학 Data Plane 이 살아 있으면 지원자에게 공지를 보여야 한다.
-- 공지는 공개 정보만 담고, 삭제·본문 덮어쓰기 없이 발행 뒤 해제만 한다.
-- 다시 실행해도 된다.

SET search_path TO kadmission, public;

CREATE TABLE IF NOT EXISTS service_incident (
  id uuid PRIMARY KEY,
  severity varchar(16) NOT NULL CHECK (severity IN ('NOTICE', 'DEGRADED', 'OUTAGE')),
  title varchar(120) NOT NULL CHECK (btrim(title) <> ''),
  message varchar(1000) NOT NULL CHECK (btrim(message) <> ''),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expected_resolved_at timestamptz,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESOLVED')),
  created_by varchar(160) NOT NULL CHECK (btrim(created_by) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by varchar(160),
  resolved_at timestamptz,
  CONSTRAINT service_incident_expected_after_start CHECK (
    expected_resolved_at IS NULL OR expected_resolved_at > starts_at
  ),
  CONSTRAINT service_incident_resolution_complete CHECK (
    (status = 'ACTIVE' AND resolved_by IS NULL AND resolved_at IS NULL)
    OR
    (status = 'RESOLVED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolved_at >= starts_at)
  )
);

CREATE INDEX IF NOT EXISTS idx_service_incident_active
  ON service_incident (severity, starts_at DESC) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_service_incident_created
  ON service_incident (created_at DESC);

-- 이미 0002(역할)·0006(쓰기 펜스)가 지나간 뒤 생기는 표이므로 이 마이그레이션에서 직접 붙인다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER TABLE service_incident OWNER TO kadmission_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_app') THEN
    REVOKE ALL ON service_incident FROM kadmission_app;
    GRANT SELECT, INSERT, UPDATE ON service_incident TO kadmission_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_auditor') THEN
    GRANT SELECT ON service_incident TO kadmission_auditor;
  END IF;
END $$;

DROP TRIGGER IF EXISTS writer_fence ON service_incident;
CREATE TRIGGER writer_fence BEFORE INSERT OR UPDATE OR DELETE ON service_incident
  FOR EACH STATEMENT EXECUTE FUNCTION writer_fence_check();

-- 공지 원문과 발행자를 뒤에서 바꾸거나 지우지 못한다. 해제 열만 ACTIVE → RESOLVED 로 한 번 바꾼다.
CREATE OR REPLACE FUNCTION service_incident_resolve_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'service_incident 는 삭제할 수 없다' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'ACTIVE' OR NEW.status <> 'RESOLVED'
     OR NEW.id <> OLD.id OR NEW.severity <> OLD.severity OR NEW.title <> OLD.title
     OR NEW.message <> OLD.message OR NEW.starts_at <> OLD.starts_at
     OR NEW.expected_resolved_at IS DISTINCT FROM OLD.expected_resolved_at
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
     OR NEW.resolved_by IS NULL OR NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'service_incident 는 활성 공지의 해제만 가능하다' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_incident_resolve_only ON service_incident;
CREATE TRIGGER service_incident_resolve_only
  BEFORE UPDATE OR DELETE ON service_incident
  FOR EACH ROW EXECUTE FUNCTION service_incident_resolve_only();
DROP TRIGGER IF EXISTS service_incident_no_truncate ON service_incident;
CREATE TRIGGER service_incident_no_truncate
  BEFORE TRUNCATE ON service_incident
  FOR EACH STATEMENT EXECUTE FUNCTION service_incident_resolve_only();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER FUNCTION service_incident_resolve_only() OWNER TO kadmission_migrator;
  END IF;
END $$;
