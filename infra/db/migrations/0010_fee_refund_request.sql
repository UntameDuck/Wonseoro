-- 0010 전형료 반환·면제/감액 신청 (고등교육법 시행령 제42조의3, 문서 10 G-5, 대장 D-89)
--
-- 결제가 확인된 원서에 지원자가 반환을 신청하고(신청번호 FR-YYYYMMDD-XXXXXX), 입학처가 승인(금액)·거절(사유)로 한 번 회신한다.
-- 받는 방법은 계좌이체 또는 방문 수령(제42조의3 ⑤ — 둘 이상). 계좌·신청 내용·회신은 원서 데이터 키로 봉한다(0003 과 같은 봉투).
--   · 결정은 한 번만 — 결정한 신청은 고칠 수 없고, 어떤 신청도 지울 수 없다(트리거)
--   · 같은 원서에 검토 중 신청은 하나 — 다시 보내면 앞 신청을 돌려준다
-- 실제 이체·지급은 대학 재무 절차다. 다시 실행해도 된다.

SET search_path TO kadmission, public;

CREATE TABLE IF NOT EXISTS fee_refund_request (
  request_number varchar(20) PRIMARY KEY CHECK (request_number ~ '^FR-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{6}$'),
  application_id uuid NOT NULL REFERENCES application(id),
  reason varchar(24) NOT NULL CHECK (reason IN
    ('OVERPAID', 'UNIVERSITY_FAULT', 'DISASTER', 'HOSPITALIZED', 'DECEASED', 'STAGE_FAILED', 'EXEMPTION')),
  method varchar(16) NOT NULL CHECK (method IN ('ACCOUNT', 'VISIT')),
  account_ciphertext bytea,
  -- 화면에 보일 계좌번호 끝 네 자리 표기(예: ****5678) — 원문은 봉한 쪽에만
  account_masked varchar(16),
  detail_ciphertext bytea,
  paid_amount numeric(12,2) NOT NULL CHECK (paid_amount >= 0),
  status varchar(16) NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'APPROVED', 'REJECTED')),
  approved_amount numeric(12,2),
  received_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by varchar(160),
  result_note_ciphertext bytea,
  -- 계좌이체면 계좌가 있고, 방문이면 없다
  CONSTRAINT fee_refund_method_account CHECK (
    (method = 'ACCOUNT' AND account_ciphertext IS NOT NULL AND account_masked IS NOT NULL)
    OR (method = 'VISIT' AND account_ciphertext IS NULL AND account_masked IS NULL)
  ),
  -- 검토 중이면 결과 칸이 비고, 결정했으면 시각·담당자·안내가 있다. 승인은 금액(낸 금액 이하), 거절은 금액 없음
  CONSTRAINT fee_refund_decision_complete CHECK (
    (status = 'RECEIVED' AND decided_at IS NULL AND decided_by IS NULL AND result_note_ciphertext IS NULL AND approved_amount IS NULL)
    OR (status = 'APPROVED' AND decided_at IS NOT NULL AND btrim(decided_by) <> '' AND result_note_ciphertext IS NOT NULL
        AND approved_amount IS NOT NULL AND approved_amount > 0 AND approved_amount <= paid_amount)
    OR (status = 'REJECTED' AND decided_at IS NOT NULL AND btrim(decided_by) <> '' AND result_note_ciphertext IS NOT NULL
        AND approved_amount IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_refund_open ON fee_refund_request (application_id) WHERE status = 'RECEIVED';
CREATE INDEX IF NOT EXISTS idx_fee_refund_queue ON fee_refund_request (status, received_at);
CREATE INDEX IF NOT EXISTS idx_fee_refund_application ON fee_refund_request (application_id, received_at);

CREATE OR REPLACE FUNCTION fee_refund_request_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fee_refund_request 는 지울 수 없다' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'RECEIVED' THEN
    RAISE EXCEPTION '이미 결정한 반환 신청은 바꿀 수 없다' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.request_number <> OLD.request_number OR NEW.application_id <> OLD.application_id
     OR NEW.reason <> OLD.reason OR NEW.method <> OLD.method
     OR NEW.account_ciphertext IS DISTINCT FROM OLD.account_ciphertext OR NEW.account_masked IS DISTINCT FROM OLD.account_masked
     OR NEW.detail_ciphertext IS DISTINCT FROM OLD.detail_ciphertext
     OR NEW.paid_amount <> OLD.paid_amount OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION '반환 신청의 내용·계좌·금액·받은 시각은 바꿀 수 없다' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS fee_refund_request_guard ON fee_refund_request;
CREATE TRIGGER fee_refund_request_guard
  BEFORE UPDATE OR DELETE ON fee_refund_request
  FOR EACH ROW EXECUTE FUNCTION fee_refund_request_guard();
DROP TRIGGER IF EXISTS fee_refund_request_no_truncate ON fee_refund_request;
CREATE TRIGGER fee_refund_request_no_truncate
  BEFORE TRUNCATE ON fee_refund_request
  FOR EACH STATEMENT EXECUTE FUNCTION fee_refund_request_guard();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER TABLE fee_refund_request OWNER TO kadmission_migrator;
    ALTER FUNCTION fee_refund_request_guard() OWNER TO kadmission_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_app') THEN
    REVOKE ALL ON fee_refund_request FROM kadmission_app;
    GRANT SELECT, INSERT ON fee_refund_request TO kadmission_app;
    GRANT UPDATE (status, approved_amount, decided_at, decided_by, result_note_ciphertext) ON fee_refund_request TO kadmission_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_auditor') THEN
    GRANT SELECT ON fee_refund_request TO kadmission_auditor;
  END IF;
END $$;

DROP TRIGGER IF EXISTS writer_fence ON fee_refund_request;
CREATE TRIGGER writer_fence BEFORE INSERT OR UPDATE OR DELETE ON fee_refund_request
  FOR EACH STATEMENT EXECUTE FUNCTION writer_fence_check();
