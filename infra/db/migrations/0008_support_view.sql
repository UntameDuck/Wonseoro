-- 0008 개인정보 최소 상담 조회 (T-M6-07, 노션 §01 B11, 대장 D-79)
--
-- 장애 중 고객센터가 이름·연락처 없이 원서를 찾고, 그때 무엇을 안내했는지 증적번호로 남긴다.
--   ① application.support_code — 원서마다 DB 가 만드는 상담 확인번호(Crockford base32 10자).
--      지원자는 자기 상태 확인 화면에서 이 번호를 보고 상담원에게 불러 준다. 접수 전 원서에는 접수번호가 없다.
--   ② support_lookup — 조회 한 번 = 증적번호 하나. 그 순간 보인 응답과 해시를 추가만 한다.
-- 다시 실행해도 된다.

SET search_path TO kadmission, public;

-- 무작위는 gen_random_uuid()(PG13+, 암호학적 난수)의 바이트에서 뽑는다. 버전·변형 비트가 있는
-- 6·8 번째 바이트는 건너뛴다(256 은 32 로 나누어떨어져 나머지 연산이 고르게 나온다). 50비트.
CREATE OR REPLACE FUNCTION support_code_generate() RETURNS varchar
LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', get_byte(b, i) % 32 + 1, 1), '' ORDER BY ord)
    FROM (SELECT decode(replace(gen_random_uuid()::text, '-', ''), 'hex') AS b) s,
         unnest(ARRAY[0, 1, 2, 3, 4, 5, 7, 9, 10, 11]) WITH ORDINALITY AS t(i, ord)
$$;

-- 기본값으로 붙이면 기존 행도 채워지고(표를 한 번 다시 쓴다), 원서를 만드는 어느 경로도 고칠 필요가 없다
ALTER TABLE application
  ADD COLUMN IF NOT EXISTS support_code varchar(10) NOT NULL DEFAULT support_code_generate();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_support_code_format') THEN
    ALTER TABLE application ADD CONSTRAINT application_support_code_format
      CHECK (support_code ~ '^[0-9A-HJKMNP-TV-Z]{10}$');
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_support_code ON application (support_code);

-- 상담 확인번호는 원서가 사는 동안 바뀌지 않는다 — 지원자가 받아 적은 번호가 상담 때 그대로 맞아야 한다
CREATE OR REPLACE FUNCTION application_support_code_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.support_code <> OLD.support_code THEN
    RAISE EXCEPTION '상담 확인번호는 바꿀 수 없다' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS application_support_code_fixed ON application;
CREATE TRIGGER application_support_code_fixed
  BEFORE UPDATE OF support_code ON application
  FOR EACH ROW EXECUTE FUNCTION application_support_code_fixed();

CREATE TABLE IF NOT EXISTS support_lookup (
  evidence_number varchar(20) PRIMARY KEY CHECK (evidence_number ~ '^SR-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{6}$'),
  application_id uuid NOT NULL REFERENCES application(id),
  lookup_kind varchar(24) NOT NULL CHECK (lookup_kind IN ('APPLICATION_NUMBER', 'SUPPORT_CODE')),
  reason varchar(16) NOT NULL CHECK (reason IN ('STATUS', 'PAYMENT', 'DOCUMENT', 'INCIDENT', 'OTHER')),
  agent_id varchar(160) NOT NULL CHECK (btrim(agent_id) <> ''),
  looked_up_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  snapshot_hash char(64) NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_support_lookup_application ON support_lookup (application_id, looked_up_at);
CREATE INDEX IF NOT EXISTS idx_support_lookup_time ON support_lookup (looked_up_at DESC);

-- 0002(역할)·0006(쓰기 펜스) 뒤에 생기는 표라 여기서 직접 붙인다
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER TABLE support_lookup OWNER TO kadmission_migrator;
    ALTER FUNCTION support_code_generate() OWNER TO kadmission_migrator;
    ALTER FUNCTION application_support_code_fixed() OWNER TO kadmission_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_app') THEN
    REVOKE ALL ON support_lookup FROM kadmission_app;
    GRANT SELECT, INSERT ON support_lookup TO kadmission_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_auditor') THEN
    GRANT SELECT ON support_lookup TO kadmission_auditor;
  END IF;
END $$;

DROP TRIGGER IF EXISTS writer_fence ON support_lookup;
CREATE TRIGGER writer_fence BEFORE INSERT OR UPDATE OR DELETE ON support_lookup
  FOR EACH STATEMENT EXECUTE FUNCTION writer_fence_check();

-- 상담 증적은 추가만 한다 — 소유자라도 평소 경로로는 고치거나 지울 수 없다 (감사 기록과 같은 규칙)
CREATE OR REPLACE FUNCTION support_lookup_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'support_lookup 는 추가만 가능하다 (% 거부)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS support_lookup_append_only ON support_lookup;
CREATE TRIGGER support_lookup_append_only
  BEFORE UPDATE OR DELETE ON support_lookup
  FOR EACH ROW EXECUTE FUNCTION support_lookup_append_only();
DROP TRIGGER IF EXISTS support_lookup_no_truncate ON support_lookup;
CREATE TRIGGER support_lookup_no_truncate
  BEFORE TRUNCATE ON support_lookup
  FOR EACH STATEMENT EXECUTE FUNCTION support_lookup_append_only();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER FUNCTION support_lookup_append_only() OWNER TO kadmission_migrator;
  END IF;
END $$;
