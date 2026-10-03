-- 0003 원서 항목 값 암호화 — 봉투 암호화 (T-M5-06, docs/13 단계 3)
--
-- 노션 §02 첨부 DDL(0001)에는 없다 — 저장소가 더한다(대장 D-70, 변경안 06).
-- 원서 항목 값(application_field_value)은 지원자가 쓴 개인정보다(공통원서 Snapshot 의 연락처·학교, 자기소개 등).
-- 값은 원서마다 다른 데이터 키(DEK)로 AES-256-GCM 암호화해 value_ciphertext 에 두고, DEK 는 키 암호화 키(KEK)로 감싸
-- application_data_key 에 둔다. KEK 는 DB 에 없다(환경 → 단계 4 Vault Transit).
--
-- value_json 은 이 마이그레이션 전 행(평문)을 위해 남긴다 — 한 행은 둘 중 하나만 갖는다.
-- 남은 평문은 앱의 `field-keys encrypt-legacy` 가 암호문으로 옮긴다. 운영 전환 뒤 평문 행 0 을 db:verify 가 본다.
-- 다시 돌려도 된다(IF NOT EXISTS).

SET search_path TO kadmission, public;

CREATE TABLE IF NOT EXISTS application_data_key (
  application_id uuid PRIMARY KEY REFERENCES application(id) ON DELETE CASCADE,
  -- DEK 를 감싼 KEK 의 ID. KEK 교체 뒤 rewrap 이 바꾼다(값은 다시 암호화하지 않는다)
  kek_version varchar(64) NOT NULL,
  -- 로컬 KEK: iv(12) | tag(16) | 감싼 DEK(32) = 60바이트, Vault Transit: "vault:vN:…" 글자 — 연결 데이터는 대학 ID·원서 ID 라 다른 대학 DB 로 옮기면 풀리지 않는다
  wrapped_dek bytea NOT NULL CHECK (octet_length(wrapped_dek) BETWEEN 60 AND 1024),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_data_key_kek ON application_data_key(kek_version);

ALTER TABLE application_field_value ADD COLUMN IF NOT EXISTS value_ciphertext bytea;
ALTER TABLE application_field_value ALTER COLUMN value_json DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_field_value_one_form') THEN
    ALTER TABLE application_field_value
      ADD CONSTRAINT application_field_value_one_form CHECK ((value_json IS NULL) <> (value_ciphertext IS NULL));
  END IF;
END $$;

-- 권한 — 0002 의 규칙대로. 감사 역할은 감싼 키를 읽지 않는다(필요도 없다)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER TABLE application_data_key OWNER TO kadmission_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON application_data_key TO kadmission_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_auditor') THEN
    REVOKE ALL ON application_data_key FROM kadmission_auditor;
  END IF;
END $$;
