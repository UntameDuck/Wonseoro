-- 0005 공통원서 수집·이용 동의 기록 (문서 10 G-3, 대장 D-82)
--
-- 공통원서는 운영기관이 처리자다. 저장할 때 지금 판 문안에 동의했는지를 판·문안 해시·시각으로 남긴다.
-- 대학별 제공 동의(profile_release_consent)와는 따로다 — 제공 동의는 대학마다, 수집·이용 동의는 공통원서에 하나.
-- 다시 실행해도 된다.

ALTER TABLE kadmission_vault.applicant_profile
  ADD COLUMN IF NOT EXISTS collection_consent_version varchar(32),
  ADD COLUMN IF NOT EXISTS collection_consent_hash char(64),
  ADD COLUMN IF NOT EXISTS collection_consented_at timestamptz;
