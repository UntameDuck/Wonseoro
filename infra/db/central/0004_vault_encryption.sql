-- 0004 공통원서 금고 암호화 — 봉투 암호화 (T-M5-06, docs/13 단계 3)
--
-- 0002 가 "M5 에서 Field-level 암호화로 교체한다" 고 남긴 자리. 공통원서(연락처·학교)는 여러 대학이 가져가는 개인정보라
-- 한곳에 모이면 집중 위험이 된다(v1.0 §8.3). 공통원서 하나마다 데이터 키(DEK)를 새로 만들어 항목 전체를 AES-256-GCM 으로 봉하고,
-- DEK 는 키 암호화 키(KEK)로 감싸 같은 행에 둔다. key_version 이 KEK 의 ID 다('plaintext-dev' = 이 마이그레이션 전 평문 행).
-- 평문 행은 다음 저장 때 암호문으로 바뀐다. 남은 것은 중앙의 `field-keys encrypt-legacy` 가 옮긴다.
-- 다시 돌려도 된다(IF NOT EXISTS).

SET search_path TO kadmission_vault, public;

ALTER TABLE applicant_profile ADD COLUMN IF NOT EXISTS fields_ciphertext bytea;
ALTER TABLE applicant_profile ADD COLUMN IF NOT EXISTS wrapped_dek bytea;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applicant_profile_sealed_or_legacy') THEN
    -- 평문 행(옛 형식) 아니면 암호문 + 감싼 DEK + 빈 평문 칸
    ALTER TABLE applicant_profile ADD CONSTRAINT applicant_profile_sealed_or_legacy CHECK (
      (key_version = 'plaintext-dev' AND fields_ciphertext IS NULL AND wrapped_dek IS NULL)
      OR (key_version <> 'plaintext-dev' AND fields_ciphertext IS NOT NULL AND octet_length(wrapped_dek) BETWEEN 60 AND 1024 AND fields = '{}'::jsonb)
    );
  END IF;
END $$;
