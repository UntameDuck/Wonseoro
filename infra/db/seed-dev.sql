-- 개발용 시드. 운영에서는 절대 적용하지 않는다.
--
-- 대학별 추가문항은 코드가 아니라 config_version.config_json 에 들어간다. (v1.1 §A5)
-- 대학을 하나 더 붙일 때 apps/ 아래를 고칠 필요가 없다는 것이 이 설계의 요점이다.
--
-- 실행: npm run db:seed

SET search_path TO kadmission, public;

INSERT INTO university (id, name, status)
VALUES ('UNIV-A', '원서로대학교', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO admission_cycle (id, university_id, admission_year, name, opens_at, closes_at, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'UNIV-A', 2027, '2027 수시',
        '2026-09-01T00:00:00Z', '2026-12-31T09:00:00Z', 'OPEN')
ON CONFLICT (id) DO NOTHING;

INSERT INTO admission_type (id, cycle_id, code, name, fee_amount)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'EARLY', '학생부종합전형', 55000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO department (id, cycle_id, code, name, quota)
VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
        'CSE', '컴퓨터공학과', 40)
ON CONFLICT (id) DO NOTHING;

INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
VALUES ('44444444-4444-4444-4444-444444444444', 'subj-dev-0001', '\x00', 'v1')
ON CONFLICT (id) DO NOTHING;

-- 활성 Config. 추가문항 JSON Schema 가 여기에 들어간다.
-- M3 에서는 2인 승인을 거쳐야 ACTIVE 가 된다. (T-M3-02)
INSERT INTO config_version (id, cycle_id, version, status, config_json, config_hash,
                            created_by, approved_by_1, approved_by_2, approved_at, activated_at)
VALUES (
  '55555555-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'cfg-2027-v1',
  'ACTIVE',
  '{
     "forms": {
       "EARLY": {
         "type": "object",
         "additionalProperties": false,
         "required": ["highSchool", "graduationYear", "selfIntro"],
         "properties": {
           "highSchool":      { "type": "string",  "minLength": 2, "maxLength": 100 },
           "graduationYear":  { "type": "integer", "minimum": 1990, "maximum": 2030 },
           "gpa":             { "type": "number",  "minimum": 0, "maximum": 5 },
           "selfIntro":       { "type": "string",  "minLength": 10, "maxLength": 1500 },
           "contactEmail":    { "type": "string",  "format": "email" }
         }
       }
     }
   }'::jsonb,
  'dev-hash',
  'dev-seed',
  'admin1@univ-a',
  'admin2@univ-a',
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE
  SET config_json = EXCLUDED.config_json,
      status = 'ACTIVE',
      activated_at = now();

SELECT 'seeded: ' || (SELECT count(*) FROM config_version WHERE status = 'ACTIVE')
       || ' active config' AS result;
