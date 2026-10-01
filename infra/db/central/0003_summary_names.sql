-- 중앙 0003 — 내 원서 요약에 전형·모집단위 표시 이름 (T-M5-51, docs/08-ui-production-readiness.md U-7)
--
-- "내 원서" 가 전형·모집단위를 코드(`EARLY · CSE`)로 보였다. 지원자가 읽을 말이 아니다.
-- 대학이 접수 알림(application.finalized)에 표시 이름을 함께 싣는다 — 선택 필드라 이름이 없는 옛 알림도 받고,
-- 그 행은 이름이 null 이다. 이름은 개인정보가 아니다. 중앙이 대학에 되묻지 않는다(§A3 — 중앙은 요약만 갖는다).
--
-- 여러 번 적용해도 같은 결과다.
SET search_path TO kadmission_central;

ALTER TABLE application_summary ADD COLUMN IF NOT EXISTS admission_type_name varchar(200);
ALTER TABLE application_summary ADD COLUMN IF NOT EXISTS department_name varchar(200);
