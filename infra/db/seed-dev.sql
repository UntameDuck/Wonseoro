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
--
-- 화면은 이 설정만 보고 그린다 (§A5, D-56)
--   title          항목 이름
--   x-profile      공통원서(중앙 Vault)에서 가져오는 항목 — 1단계에 그린다
--   x-multiline    여러 줄 입력
--   optionalDocuments / requiredDocuments  올릴 서류. required 는 결제(=접수) 전에 검사를 통과해야 한다
--   documentLabels 서류 이름
--
-- 대입 전형은 자기소개서를 받지 않는다(고등교육법 시행령 제35조, 문서 10 G-1). 전에는 이 시드가 「자기소개」를 필수로 받았다.
-- 설정 검사가 자기소개서류 항목을 경고한다. 여러 줄 필수 항목의 예로 「학적 변동 사항」을 둔다
--   consents       원서 동의 문안(D-81) — 수집·이용(필수)·학생부·수능 온라인 제공 확인(필수). 예시 문안이다 — 대학은 법무가 승인한 문안·보유기간으로 바꾼다
--   notices        지원자 고지(D-80) — 처리방침·위탁 주소, 보호책임자, 전형료 반환 안내. 주소는 예약 도메인(.test)이고
--                  반환 안내는 고등교육법 시행령 제42조의3 을 옮긴 예시다. 대학은 입학처·법무가 승인한 문안으로 바꾼다
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
         "required": ["highSchool", "graduationYear", "academicNote"],
         "properties": {
           "highSchool":      { "type": "string",  "minLength": 2, "maxLength": 100, "title": "출신 고등학교", "x-profile": true },
           "graduationYear":  { "type": "integer", "minimum": 1990, "maximum": 2030, "title": "졸업(예정) 연도", "x-profile": true },
           "gpa":             { "type": "number",  "minimum": 0, "maximum": 5, "title": "내신 성적" },
           "academicNote":    { "type": "string",  "minLength": 2, "maxLength": 1000, "title": "학적 변동 사항", "description": "전학·편입학·검정고시 등을 적습니다. 없으면 「없음」이라고 적습니다.", "x-multiline": true },
           "contactEmail":    { "type": "string",  "format": "email", "title": "이메일", "x-profile": true }
         }
       }
     },
     "optionalDocuments": { "EARLY": ["TRANSCRIPT"] },
     "documentLabels": { "TRANSCRIPT": "학교생활기록부" },
     "consents": [{"code": "APPLICATION_COLLECTION", "title": "개인정보 수집·이용", "required": true, "version": "2027-v1", "text": "원서로대학교는 입학전형을 위해 아래와 같이 개인정보를 수집·이용합니다.\n수집 목적: 입학전형 진행, 합격자 발표와 등록, 전형료 반환, 입시 관련 연락\n수집 항목: 출신 고등학교, 졸업(예정) 연도, 내신 성적, 학적 변동 사항, 이메일, 제출 서류, 전형료 결제 기록\n보유 기간: 접수한 원서는 10년(대학 기록물 보존 기준), 접수하지 않은 원서는 모집이 끝난 뒤 지체 없이 파기\n동의를 거부할 권리가 있습니다. 다만 동의하지 않으면 원서를 접수할 수 없습니다."}, {"code": "SCHOOL_RECORD_PROVISION", "title": "학교생활기록부·수능 성적 온라인 제공", "required": true, "version": "2027-v1", "text": "입학전형을 위해 학교생활기록부와 대학수학능력시험 성적을 관계 기관(한국대학교육협의회·한국교육과정평가원)에서 온라인으로 제공받습니다(초·중등교육법 제30조의6).\n제공받은 자료는 입학전형 목적으로만 쓰고 다른 목적으로 쓰지 않습니다.\n온라인 제공이 되지 않는 지원자(검정고시·해외 고교 등)는 모집요강에 따라 서류를 따로 냅니다."}],
     "notices": {
       "privacyPolicyUrl": "https://www.univ-a.test/privacy",
       "processorsUrl": "https://www.univ-a.test/privacy#processors",
       "privacyOfficer": "원서로대학교 입학처 개인정보 보호 담당",
       "feeRefund": "전형료는 다음의 경우 돌려드립니다.\n1. 착오로 더 낸 경우: 더 낸 금액\n2. 대학의 사정으로 전형에 응시하지 못한 경우: 낸 금액 전부\n3. 천재지변, 질병·사고로 인한 입원, 본인 사망으로 응시하지 못한 경우: 낸 금액 전부\n4. 단계별 전형에서 앞 단계에 불합격한 경우: 응시하지 않은 단계의 전형료\n돌려드리는 방법: 지원자가 알려 준 계좌로 이체합니다. 이체 수수료를 뺀 금액을 돌려드리며, 수수료가 돌려드릴 금액 이상이면 돌려드리지 않을 수 있습니다. 전형을 마친 뒤 남은 전형료는 다음 해 4월 30일까지 돌려드립니다."
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
