-- 개발 전용 — 앱 역할에 로그인을 연다. (D-41)
--
-- 0004 는 역할을 NOLOGIN 으로 만든다. 비밀번호를 마이그레이션에 넣으면 운영에도 같은
-- 비밀번호가 깔린다. 운영 비밀번호는 Vault 가 준다 (M5).
--
-- 실행: npm run db:roles:dev

ALTER ROLE kadmission_app LOGIN PASSWORD 'kadmission_app_dev';
