-- 0011 접근 권한 부여·변경·말소 기록 (개인정보의 안전성 확보조치 기준 제5조 ③ — 최소 3년, 문서 10 G-15, 대장 D-91)
--
-- 담당자 계정의 권한은 로그인 서버(담당자 렐름)에 있다. 수집 도구(`dist/tools/access-grant-sync.js`)가
-- 로그인 서버의 관리 이벤트(역할·그룹·계정 변경)를 읽어 이 표에 옮기고, 매번 실제 권한과 기록으로 복원한 권한을 대조해
-- 어긋나면(관리 이벤트가 꺼져 있었거나 보관기간이 지나 빠진 변경) 대조 기록(RECONCILED)을 남긴다.
--   · 추가만 — 고치기·지우기·비우기는 트리거가 계정과 관계없이 막는다. 지우는 경로가 없다(보존 하한 3년, purge NONE)
--   · 위변조 검출 — 행마다 앞 행의 해시를 이어 SHA-256 을 DB 가 계산한다(넣는 쪽이 정하지 못한다).
--     순번도 잠금 안에서 트리거가 매긴다 — 동시에 넣어도 순번 순서 = 체인 순서. 검증은 access_grant_log_verify()
--   · 같은 이벤트를 두 번 옮겨도 한 줄 — (source, source_event_id) 유일
--   · 개인정보를 담지 않는다 — 계정 ID·역할 이름·변경한 계정 ID 만. 이름·이메일·IP 는 옮기지 않는다
-- 다시 실행해도 된다.

SET search_path TO kadmission, public;

CREATE SEQUENCE IF NOT EXISTS access_grant_log_seq;

CREATE TABLE IF NOT EXISTS access_grant_log (
  seq bigint PRIMARY KEY,
  source varchar(16) NOT NULL CHECK (source IN ('IDP')),
  source_event_id varchar(200) NOT NULL,
  occurred_at timestamptz NOT NULL,
  action varchar(16) NOT NULL CHECK (action IN ('BASELINE', 'GRANT', 'CHANGE', 'REVOKE')),
  change_kind varchar(32) NOT NULL CHECK (change_kind IN (
    'BASELINE', 'RECONCILED',
    'ROLE_ADDED', 'ROLE_REMOVED', 'GROUP_JOINED', 'GROUP_LEFT',
    'ACCOUNT_CREATED', 'ACCOUNT_UPDATED', 'ACCOUNT_DISABLED', 'ACCOUNT_DELETED',
    'ROLE_DEFINITION_CHANGED')),
  -- 권한이 바뀐 대상 — 계정이면 계정 ID, 그룹이면 group:<ID>, 역할 정의면 role:<경로>
  subject varchar(200) NOT NULL CHECK (btrim(subject) <> ''),
  -- 이 변경으로 더하거나 뺀 권한(BASELINE·RECONCILED 는 그 시각의 전체 권한) — 렐름 역할 이름, 클라이언트 역할은 <클라이언트>:<역할>, 그룹은 group:<경로>
  roles text[] NOT NULL DEFAULT '{}',
  -- 바꾼 사람(로그인 서버 관리자 계정 ID). 대조·기준 기록은 없다
  actor varchar(200),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  prev_hash char(64),
  row_hash char(64) NOT NULL,
  CONSTRAINT access_grant_log_event_once UNIQUE (source, source_event_id),
  CONSTRAINT access_grant_log_actor CHECK (
    (change_kind IN ('BASELINE', 'RECONCILED') AND actor IS NULL)
    OR (change_kind NOT IN ('BASELINE', 'RECONCILED') AND actor IS NOT NULL AND btrim(actor) <> '')
  )
);
CREATE INDEX IF NOT EXISTS idx_access_grant_subject ON access_grant_log (subject, seq);
CREATE INDEX IF NOT EXISTS idx_access_grant_occurred ON access_grant_log (source, occurred_at);

-- 한 행의 해시 — 트리거와 검증이 같은 함수를 쓴다. 시각은 UTC 마이크로초 문자열, details 는 jsonb 정규 문자열
CREATE OR REPLACE FUNCTION access_grant_log_hash(
  p_prev char(64), p_seq bigint, p_source varchar, p_event varchar, p_occurred timestamptz, p_action varchar,
  p_kind varchar, p_subject varchar, p_roles text[], p_actor varchar, p_details jsonb, p_recorded timestamptz
) RETURNS char(64)
LANGUAGE sql IMMUTABLE SET search_path = kadmission, public AS $$
  SELECT encode(sha256(convert_to(concat_ws(chr(31),
    coalesce(p_prev, ''), p_seq::text, p_source, p_event,
    to_char(p_occurred AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    p_action, p_kind, p_subject, array_to_string(p_roles, chr(30)), coalesce(p_actor, ''), p_details::text,
    to_char(p_recorded AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'UTF8')), 'hex')
$$;

-- 함수는 검색 경로를 고정한다 — 세션의 search_path 가 kadmission 이 아니어도(관리자 psql·다른 도구) 같은 순번·표를 본다
CREATE OR REPLACE FUNCTION access_grant_log_chain() RETURNS trigger
LANGUAGE plpgsql SET search_path = kadmission, public AS $$
DECLARE prev char(64);
BEGIN
  -- 넣는 쪽이 순번·시각·해시를 정하지 못한다. 잠금은 트랜잭션 끝까지 — 순번 순서가 곧 체인 순서
  PERFORM pg_advisory_xact_lock(hashtext('kadmission.access_grant_log'));
  NEW.seq := nextval('access_grant_log_seq');
  NEW.recorded_at := clock_timestamp();
  SELECT row_hash INTO prev FROM access_grant_log ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.row_hash := access_grant_log_hash(prev, NEW.seq, NEW.source, NEW.source_event_id, NEW.occurred_at, NEW.action,
    NEW.change_kind, NEW.subject, NEW.roles, NEW.actor, NEW.details, NEW.recorded_at);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS access_grant_log_chain ON access_grant_log;
CREATE TRIGGER access_grant_log_chain
  BEFORE INSERT ON access_grant_log
  FOR EACH ROW EXECUTE FUNCTION access_grant_log_chain();

CREATE OR REPLACE FUNCTION access_grant_log_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '권한 변경 기록은 고치거나 지울 수 없다' USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS access_grant_log_guard ON access_grant_log;
CREATE TRIGGER access_grant_log_guard
  BEFORE UPDATE OR DELETE ON access_grant_log
  FOR EACH ROW EXECUTE FUNCTION access_grant_log_guard();
DROP TRIGGER IF EXISTS access_grant_log_no_truncate ON access_grant_log;
CREATE TRIGGER access_grant_log_no_truncate
  BEFORE TRUNCATE ON access_grant_log
  FOR EACH STATEMENT EXECUTE FUNCTION access_grant_log_guard();

-- 체인 검증 — 처음부터 순번 순서로 앞 해시 연결과 각 행의 해시를 다시 계산한다.
-- 끊긴 곳이 없으면 broken_seq 가 NULL. 트리거를 끄고 고친 행(슈퍼유저)도 여기서 드러난다
CREATE OR REPLACE FUNCTION access_grant_log_verify()
RETURNS TABLE (checked bigint, broken_seq bigint, last_hash char(64))
LANGUAGE plpgsql STABLE SET search_path = kadmission, public AS $$
DECLARE r record; prev char(64) := NULL; n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM access_grant_log ORDER BY seq LOOP
    n := n + 1;
    IF r.prev_hash IS DISTINCT FROM prev
       OR r.row_hash <> access_grant_log_hash(r.prev_hash, r.seq, r.source, r.source_event_id, r.occurred_at, r.action,
            r.change_kind, r.subject, r.roles, r.actor, r.details, r.recorded_at) THEN
      checked := n; broken_seq := r.seq; last_hash := prev;
      RETURN NEXT;
      RETURN;
    END IF;
    prev := r.row_hash;
  END LOOP;
  checked := n; broken_seq := NULL; last_hash := prev;
  RETURN NEXT;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER TABLE access_grant_log OWNER TO kadmission_migrator;
    ALTER SEQUENCE access_grant_log_seq OWNER TO kadmission_migrator;
    ALTER FUNCTION access_grant_log_hash(char, bigint, varchar, varchar, timestamptz, varchar, varchar, varchar, text[], varchar, jsonb, timestamptz) OWNER TO kadmission_migrator;
    ALTER FUNCTION access_grant_log_chain() OWNER TO kadmission_migrator;
    ALTER FUNCTION access_grant_log_guard() OWNER TO kadmission_migrator;
    ALTER FUNCTION access_grant_log_verify() OWNER TO kadmission_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_app') THEN
    REVOKE ALL ON access_grant_log FROM kadmission_app;
    GRANT SELECT, INSERT ON access_grant_log TO kadmission_app;
    -- 트리거가 nextval 을 부른다 — 값을 되돌리는 setval(UPDATE 권한)은 주지 않는다
    REVOKE ALL ON SEQUENCE access_grant_log_seq FROM kadmission_app;
    GRANT USAGE ON SEQUENCE access_grant_log_seq TO kadmission_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_auditor') THEN
    GRANT SELECT ON access_grant_log TO kadmission_auditor;
  END IF;
END $$;

DROP TRIGGER IF EXISTS writer_fence ON access_grant_log;
CREATE TRIGGER writer_fence BEFORE INSERT OR UPDATE OR DELETE ON access_grant_log
  FOR EACH STATEMENT EXECUTE FUNCTION writer_fence_check();
