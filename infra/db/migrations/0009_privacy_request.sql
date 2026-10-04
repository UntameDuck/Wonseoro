-- 0009 정보주체 권리 요청 — 대학 원서의 열람·정정·삭제·처리정지 (문서 10 G-10, 대장 D-84)
--
-- 지원자가 자기 원서에 요청을 남기고(요청번호 PR-YYYYMMDD-XXXXXX), 입학처가 법정 기한(받은 날부터 10일) 안에
-- 결과를 한 번 회신한다. 지원자가 쓴 내용·입학처 회신은 원서 데이터 키로 봉한다(0003 과 같은 봉투 암호화) —
-- 정정 요청에는 바꿀 개인정보가 그대로 적힌다.
--   · 결과는 한 번만 정한다 — 회신한 요청은 고칠 수 없고, 어떤 요청도 지울 수 없다(트리거)
--   · 같은 원서에 같은 종류의 처리 중 요청은 하나 — 다시 보내면 앞 요청을 돌려준다
-- 다시 실행해도 된다.

SET search_path TO kadmission, public;

CREATE TABLE IF NOT EXISTS privacy_request (
  request_number varchar(20) PRIMARY KEY CHECK (request_number ~ '^PR-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{6}$'),
  application_id uuid NOT NULL REFERENCES application(id),
  kind varchar(16) NOT NULL CHECK (kind IN ('ACCESS', 'CORRECTION', 'DELETION', 'SUSPENSION')),
  detail_ciphertext bytea,
  status varchar(24) NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'REFUSED')),
  received_at timestamptz NOT NULL DEFAULT now(),
  -- 법정 기한. 받은 시각에서 계산해 넣는다 — 나중에 규칙이 바뀌어도 그때 약속한 기한이 남는다
  due_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by varchar(160),
  result_note_ciphertext bytea,
  CONSTRAINT privacy_request_due_after_received CHECK (due_at > received_at),
  -- 처리 중이면 결과 칸이 비어 있고, 회신했으면 시각·담당자·안내가 모두 있다
  CONSTRAINT privacy_request_decision_complete CHECK (
    (status = 'RECEIVED' AND decided_at IS NULL AND decided_by IS NULL AND result_note_ciphertext IS NULL)
    OR (status <> 'RECEIVED' AND decided_at IS NOT NULL AND btrim(decided_by) <> '' AND result_note_ciphertext IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_privacy_request_open_kind
  ON privacy_request (application_id, kind) WHERE status = 'RECEIVED';
CREATE INDEX IF NOT EXISTS idx_privacy_request_queue ON privacy_request (status, due_at);
CREATE INDEX IF NOT EXISTS idx_privacy_request_application ON privacy_request (application_id, received_at);

-- 회신은 처리 중 → 결과 한 번. 요청 내용·받은 시각·기한은 바꾸지 못한다. 지우지 못한다
CREATE OR REPLACE FUNCTION privacy_request_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'privacy_request 는 지울 수 없다' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'RECEIVED' THEN
    RAISE EXCEPTION '이미 회신한 권리 요청은 바꿀 수 없다' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.request_number <> OLD.request_number OR NEW.application_id <> OLD.application_id
     OR NEW.kind <> OLD.kind OR NEW.detail_ciphertext IS DISTINCT FROM OLD.detail_ciphertext
     OR NEW.received_at <> OLD.received_at OR NEW.due_at <> OLD.due_at THEN
    RAISE EXCEPTION '권리 요청의 내용·받은 시각·기한은 바꿀 수 없다' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS privacy_request_guard ON privacy_request;
CREATE TRIGGER privacy_request_guard
  BEFORE UPDATE OR DELETE ON privacy_request
  FOR EACH ROW EXECUTE FUNCTION privacy_request_guard();
DROP TRIGGER IF EXISTS privacy_request_no_truncate ON privacy_request;
CREATE TRIGGER privacy_request_no_truncate
  BEFORE TRUNCATE ON privacy_request
  FOR EACH STATEMENT EXECUTE FUNCTION privacy_request_guard();

-- 0002(역할)·0006(쓰기 펜스) 뒤에 생기는 표라 여기서 직접 붙인다
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER TABLE privacy_request OWNER TO kadmission_migrator;
    ALTER FUNCTION privacy_request_guard() OWNER TO kadmission_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_app') THEN
    REVOKE ALL ON privacy_request FROM kadmission_app;
    GRANT SELECT, INSERT ON privacy_request TO kadmission_app;
    GRANT UPDATE (status, decided_at, decided_by, result_note_ciphertext) ON privacy_request TO kadmission_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_auditor') THEN
    GRANT SELECT ON privacy_request TO kadmission_auditor;
  END IF;
END $$;

DROP TRIGGER IF EXISTS writer_fence ON privacy_request;
CREATE TRIGGER writer_fence BEFORE INSERT OR UPDATE OR DELETE ON privacy_request
  FOR EACH STATEMENT EXECUTE FUNCTION writer_fence_check();
