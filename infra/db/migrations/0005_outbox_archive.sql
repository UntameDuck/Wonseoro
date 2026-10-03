-- 0005 Outbox 보관 — 월별 파티션 (T-M4-10, 노션 §01 B7 "장기 장애 시 디스크 고갈 방지")
--
-- 노션 §02 첨부 DDL 밖 — 저장소가 더한다(대장 D-74).
-- outbox_event 는 전송이 끝나도 지우지 않았다 — 원서 하나에 이벤트 몇 개씩, 해마다 쌓이고 sync_receipt 도 같다.
-- 전송·확인이 끝나고 정해진 기간이 지난 이벤트를 영수증과 함께 이 보관 표로 옮긴다(앱의 보관 작업, 매시간·리더 하나).
--   - outbox_event 의 유니크(aggregate_id, aggregate_sequence)는 파티션 표가 지킬 수 없다(파티션 키를 포함해야 한다) —
--     그래서 바로 쓰는 표는 그대로 두고 보관 표만 파티션으로 나눈다
--   - 원서마다 **가장 큰 순번의 이벤트는 옮기지 않는다** — 다음 순번을 MAX()+1 로 정하므로(finalization·cancellation) 순번이 이어진다
--   - 보관 기간이 지난 달은 파티션째 지운다(DELETE 보다 가볍고 디스크를 바로 돌려준다)
-- 앱 역할에는 DDL 이 없다(0002) — 파티션을 만들고 지우는 일은 이 마이그레이션의 SECURITY DEFINER 함수 하나로만 한다(이름·범위를 함수가 정한다).
-- 다시 돌려도 된다.

SET search_path TO kadmission, public;

CREATE TABLE IF NOT EXISTS outbox_event_archive (
  id uuid NOT NULL,
  aggregate_type varchar(48) NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_sequence bigint NOT NULL,
  event_type varchar(160) NOT NULL,
  schema_version varchar(32) NOT NULL,
  payload jsonb NOT NULL,
  payload_hash varchar(128) NOT NULL,
  status varchar(20) NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  -- 영수증(sync_receipt)을 펼쳐 같이 둔다 — 증적 검증이 한 행으로 끝난다
  central_receipt_id varchar(160),
  acknowledged_at timestamptz,
  central_sequence bigint,
  receipt_hash varchar(128),
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_archive_aggregate ON outbox_event_archive(aggregate_id, aggregate_sequence);

-- 파티션 관리 — 만들 달: 이번 달부터 ahead 개월 + 보관 표에 들어올 가장 오래된 달. 지울 달: keep_months 보다 오래된 달
CREATE OR REPLACE FUNCTION outbox_archive_partitions(oldest timestamptz, ahead integer, keep_months integer)
RETURNS TABLE (created text[], dropped text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kadmission, pg_temp AS $$
DECLARE
  m date := date_trunc('month', LEAST(COALESCE(oldest, now()), now()))::date;
  last date := (date_trunc('month', now()) + make_interval(months => GREATEST(ahead, 0)))::date;
  cutoff date := (date_trunc('month', now()) - make_interval(months => GREATEST(keep_months, 1)))::date;
  name text;
  r record;
  c text[] := '{}';
  d text[] := '{}';
BEGIN
  IF keep_months < 1 OR keep_months > 120 OR ahead > 24 THEN
    RAISE EXCEPTION '보관 개월(1~120)·앞당김(0~24) 범위 밖';
  END IF;
  m := GREATEST(m, cutoff);
  WHILE m <= last LOOP
    name := format('outbox_event_archive_%s', to_char(m, 'YYYYMM'));
    IF to_regclass(format('kadmission.%I', name)) IS NULL THEN
      EXECUTE format('CREATE TABLE kadmission.%I PARTITION OF kadmission.outbox_event_archive FOR VALUES FROM (%L) TO (%L)',
                     name, m, (m + interval '1 month')::date);
      c := c || name;
    END IF;
    m := (m + interval '1 month')::date;
  END LOOP;
  FOR r IN
    SELECT child.relname AS rel
      FROM pg_inherits i
      JOIN pg_class child ON child.oid = i.inhrelid
      JOIN pg_class parent ON parent.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = parent.relnamespace
     WHERE n.nspname = 'kadmission' AND parent.relname = 'outbox_event_archive'
       AND child.relname ~ '^outbox_event_archive_[0-9]{6}$'
       AND to_date(right(child.relname, 6), 'YYYYMM') < cutoff
  LOOP
    EXECUTE format('DROP TABLE kadmission.%I', r.rel);
    d := d || r.rel::text;
  END LOOP;
  RETURN QUERY SELECT c, d;
END;
$$;
REVOKE ALL ON FUNCTION outbox_archive_partitions(timestamptz, integer, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_migrator') THEN
    ALTER TABLE outbox_event_archive OWNER TO kadmission_migrator;
    ALTER FUNCTION outbox_archive_partitions(timestamptz, integer, integer) OWNER TO kadmission_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_app') THEN
    -- 앱: 옮겨 넣고 읽기만. 고치거나 지우지 않는다(지우는 것은 파티션째, 함수가)
    REVOKE ALL ON outbox_event_archive FROM kadmission_app;
    GRANT SELECT, INSERT ON outbox_event_archive TO kadmission_app;
    GRANT EXECUTE ON FUNCTION outbox_archive_partitions(timestamptz, integer, integer) TO kadmission_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kadmission_auditor') THEN
    GRANT SELECT ON outbox_event_archive TO kadmission_auditor;
  END IF;
END $$;

-- 처음 파티션 — 이번 달과 다음 석 달
SELECT outbox_archive_partitions(now(), 3, 13);
