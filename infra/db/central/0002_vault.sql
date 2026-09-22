-- Applicant Common Profile Vault v1
--
-- ⚠️ 저장소가 1차 작성했다. 노션에 canonical DDL·API 계약이 없다. (불일치 대장 D-17)
--
-- **집계 DB 와 스키마를 분리한다.**
-- v1.0 §5: "공통원서는 Control Plane 과 분리된 Applicant Common Profile Vault 에서 관리한다"
-- v1.0 §8.3: "공통 Vault 가 새로운 개인정보 집중 위험이 되지 않도록 통제"
--
-- 운영에서는 스키마 분리로 끝내지 않는다.
--   - 별도 DB 인스턴스 · 별도 자격증명 · 별도 KMS 키
--   - Sync Gateway 서비스 계정은 이 스키마에 접근 권한이 없다
--   - Bulk Read 제한, 조회 목적·사유 기록 (v1.0 §8.3)
-- M5 에서 Field-level 암호화와 RBAC 분리를 적용한다. (T-M5-06)

CREATE SCHEMA IF NOT EXISTS kadmission_vault;
SET search_path TO kadmission_vault, public;

-- ── 공통원서 원본 ────────────────────────────────────────────────────────
-- 지원자가 한 번 쓰고 여러 대학에 재사용하는 정보다.
-- 대학 원서는 이것의 **시점 Snapshot** 이며, 여기를 고쳐도 이미 접수된 원서는 바뀌지 않는다.
CREATE TABLE applicant_profile (
  subject_token varchar(160) PRIMARY KEY,
  -- M2 는 평문 jsonb. M5 에서 Field-level 암호화로 교체한다. (T-M5-06)
  -- 컬럼명을 ciphertext 로 미리 잡으면 마이그레이션이 덜 아프다.
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  key_version varchar(64) NOT NULL DEFAULT 'plaintext-dev',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 필드 공개 동의 ───────────────────────────────────────────────────────
-- "누가 어떤 필드를 어느 대학에 제공했는지" 를 남긴다. (v1.0 §8.3 접근 증적)
-- 동의 없는 필드는 대학으로 나가지 않는다.
CREATE TABLE profile_release_consent (
  id uuid PRIMARY KEY,
  subject_token varchar(160) NOT NULL REFERENCES applicant_profile(subject_token),
  university_id varchar(32) NOT NULL,
  field_codes text[] NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (subject_token, university_id)
);

-- ── Snapshot 발급 증적 ───────────────────────────────────────────────────
-- 언제 어느 대학에 무엇을 내보냈는지. 사후 검증용이다.
-- 값은 남기지 않는다. 필드 코드만 남긴다.
CREATE TABLE profile_snapshot_log (
  id uuid PRIMARY KEY,
  subject_token varchar(160) NOT NULL,
  university_id varchar(32) NOT NULL,
  released_fields text[] NOT NULL,
  -- 대학이 이 Snapshot 으로 만든 원서. opaque id 를 받는다.
  application_ref varchar(200),
  released_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_snapshot_log_subject
  ON profile_snapshot_log(subject_token, released_at DESC);
