-- 0006 Writer fencing·승격 잠금 (T-M5-63, 노션 §01 A10 "Split-brain 방지, 단일 Writer")
--
-- 노션 §02 첨부 DDL 밖 — 저장소가 더한다(대장 D-76).
-- 장애 전환 뒤 **옛 Primary 가 쓰기 가능한 채로 돌아오면**(네트워크 분할·잘못된 재기동) 두 DB 가 동시에 접수를 받는다(split-brain).
-- 대기 DB 는 읽기 전용이라 스스로 막히지만, 옛 Primary 는 자기가 옛것인지 모른다. 그래서:
--   - DB 마다 쓰기 세대(epoch) 한 줄 — 승격할 때마다 새 Primary 에서 +1 (promote_writer, 승격 잠금·하나씩만)
--   - 앱은 자기가 아는 세대(WRITER_EPOCH, GitOps 로 바꾼다)를 트랜잭션마다 `SET LOCAL kadmission.writer_epoch` 로 넘긴다
--     (PgBouncer 트랜잭션 풀링 — 세션 설정은 넘어가지 않는다)
--   - 업무 표의 문장 단위 트리거가 둘을 대조한다 — 다르면 거절(옛 Primary 의 세대는 옛 값이라 새 세대를 아는 앱의 쓰기를 받지 않는다)
--   - require_token 을 켜면 세대를 넘기지 않은 쓰기도 거절한다(운영 — 세대 없이 쓰는 길을 남기지 않는다)
-- 다시 돌려도 된다.

SET search_path TO kadmission, public;

CREATE TABLE IF NOT EXISTS writer_fence (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  epoch bigint NOT NULL CHECK (epoch > 0),
  require_token boolean NOT NULL DEFAULT false,
  promoted_at timestamptz NOT NULL DEFAULT now(),
  promoted_by varchar(160) NOT NULL DEFAULT 'initial'
);
INSERT INTO writer_fence (singleton, epoch) VALUES (true, 1) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION writer_fence_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kadmission, pg_temp AS $$
DECLARE
  claimed text := current_setting('kadmission.writer_epoch', true);
  f record;
BEGIN
  SELECT epoch, require_token INTO f FROM kadmission.writer_fence;
  IF claimed IS NULL OR claimed = '' THEN
    IF f.require_token THEN
      RAISE EXCEPTION 'writer fenced: 쓰기 세대 없이 쓸 수 없다 (%)', TG_TABLE_NAME USING ERRCODE = 'read_only_sql_transaction';
    END IF;
    RETURN NULL;
  END IF;
  IF claimed::bigint <> f.epoch THEN
    RAISE EXCEPTION 'writer fenced: 앱의 쓰기 세대 % ≠ 이 DB 의 세대 % (%)', claimed, f.epoch, TG_TABLE_NAME
      USING ERRCODE = 'read_only_sql_transaction';
  END IF;
  RETURN NULL;
END;
$$;

-- 업무 표 전부(파티션 자식·세대 표·비상 접속 기록 빼고)에 문장 단위 트리거
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'kadmission' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
       AND c.relname NOT IN ('writer_fence', 'break_glass_access')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS writer_fence ON kadmission.%I', r.relname);
    EXECUTE format('CREATE TRIGGER writer_fence BEFORE INSERT OR UPDATE OR DELETE ON kadmission.%I
                    FOR EACH STATEMENT EXECUTE FUNCTION kadmission.writer_fence_check()', r.relname);
  END LOOP;
END $$;

-- 승격 — 새 Primary 에서 한 번. 세대는 하나씩만 오른다(건너뛰기·되돌리기 거절), 동시에 둘이 승격하지 못한다(잠금)
CREATE OR REPLACE FUNCTION promote_writer(new_epoch bigint, by_whom text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kadmission, pg_temp AS $$
DECLARE cur bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('kadmission:writer-promotion'));
  IF pg_is_in_recovery() THEN
    RAISE EXCEPTION '대기 DB 에서는 승격 세대를 올릴 수 없다 — 먼저 승격(pg_promote)한다';
  END IF;
  SELECT epoch INTO cur FROM kadmission.writer_fence FOR UPDATE;
  IF new_epoch <> cur + 1 THEN
    RAISE EXCEPTION '세대는 하나씩만 오른다: 지금 %, 요청 %', cur, new_epoch;
  END IF;
  UPDATE kadmission.writer_fence SET epoch = new_epoch, promoted_at = now(), promoted_by = by_whom;
  RETURN new_epoch;
END;
$$;
REVOKE ALL ON FUNCTION promote_writer(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION writer_fence_check() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER TABLE writer_fence OWNER TO kadmission_migrator;
    ALTER FUNCTION writer_fence_check() OWNER TO kadmission_migrator;
    ALTER FUNCTION promote_writer(bigint, text) OWNER TO kadmission_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_app') THEN
    -- 앱은 세대를 읽지도 바꾸지도 않는다 — 트리거(SECURITY DEFINER)가 본다
    REVOKE ALL ON writer_fence FROM kadmission_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_auditor') THEN
    GRANT SELECT ON writer_fence TO kadmission_auditor;
  END IF;
END $$;
