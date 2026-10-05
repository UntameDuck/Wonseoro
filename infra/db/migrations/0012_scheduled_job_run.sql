-- 0012 주기 작업의 마지막 성공 (대장 D-93)
--
-- WORM 정기 대조(D-75·D-91)는 하루 주기다. 주기를 프로세스 타이머로만 세면 하루 안에 다시 뜨는 Pod 들만 있을 때
-- 대조가 한 번도 돌지 않고, 재시작한 Pod 는 마지막 성공·불일치 수를 잃어 경보가 울리지 않는다.
-- 작업마다 한 줄 — 마지막으로 끝난 시각과 결과 요약(개수만, 식별자 없음). 지우지 않고 덮어쓴다.
-- 이 행은 "언제 돌릴지" 와 재시작 뒤 지표의 바닥값일 뿐이다 — 앱은 앞날 시각을 믿지 않고, 자기가 뜬 뒤 주기만큼 못 돌았으면 이 행과 상관없이 돈다.
-- 다시 실행해도 된다.

SET search_path TO kadmission, public;

CREATE TABLE IF NOT EXISTS scheduled_job_run (
  job varchar(120) PRIMARY KEY CHECK (job ~ '^[a-z][a-z0-9-]*:[A-Za-z0-9_-]+$'),
  last_success_at timestamptz NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object')
);

-- 이미 0002(역할)·0006(쓰기 펜스)가 지나간 뒤 생기는 표이므로 이 마이그레이션에서 직접 붙인다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER TABLE scheduled_job_run OWNER TO kadmission_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_app') THEN
    REVOKE ALL ON scheduled_job_run FROM kadmission_app;
    GRANT SELECT, INSERT, UPDATE ON scheduled_job_run TO kadmission_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_auditor') THEN
    GRANT SELECT ON scheduled_job_run TO kadmission_auditor;
  END IF;
END $$;

DROP TRIGGER IF EXISTS writer_fence ON scheduled_job_run;
CREATE TRIGGER writer_fence BEFORE INSERT OR UPDATE OR DELETE ON scheduled_job_run
  FOR EACH STATEMENT EXECUTE FUNCTION writer_fence_check();
