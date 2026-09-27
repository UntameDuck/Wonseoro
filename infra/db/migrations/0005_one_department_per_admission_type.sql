-- ============================================================================
-- 0005 — 한 전형에는 모집단위 하나만 (D-29 확정, 2026-09-27)
--
-- ⚠️ 0002 와 같은 임시 파일이다. 노션 §02 첨부 DDL 에 접어 넣은 뒤 지운다.
--
-- 0002 는 자연키를 (cycle, applicant, admission_type, department) WHERE status <> 'CANCELLED'
-- 로 두었다. 그래서 같은 전형에 모집단위만 다른 유효한 원서를 둘 가질 수 있었다.
-- 대학입학전형기본사항 — "원서접수 시, 하나의 전형에서는 하나의 모집단위에만 지원할 수 있음".
-- 모집단위를 키에서 뺀다. 취소 원서 제외(재지원 허용)는 그대로다 — 결제 전 삭제·재작성은
-- 현행 원서접수의 관행이다.
-- ============================================================================

SET search_path TO kadmission, public;

BEGIN;

DROP INDEX uq_application_active_natural_key;

CREATE UNIQUE INDEX uq_application_active_natural_key
  ON application(cycle_id, applicant_id, admission_type_id)
  WHERE status <> 'CANCELLED';

COMMIT;
