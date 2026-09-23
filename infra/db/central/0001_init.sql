-- K-Admission Central Plane 스키마 v1
--
-- ⚠️ 이 파일은 **저장소가 1차 작성했다.** 노션에 canonical DDL 이 없다. (불일치 대장 D-14)
-- 노션 첨부 `k-admission-postgresql-ddl.txt` 는 대학 Data Plane 전용이다.
--
-- 작성 근거 (이 범위를 벗어나지 않는다)
--   v1.0 §17.1  중앙 기본 수집 — 대학 ID / 전형연도·전형·모집단위 코드 /
--               Opaque Application ID / 상태 / 제출시각 / Event 무결성 값
--   v1.0 §3.1   Sync Gateway(수신·중복제거·서명검증), Aggregate Store(최소 통계/최종상태)
--   v1.1 §04    dedup key = source + id, Application 별 sequence 단조 증가
--   D-15        접수번호는 CloudEvents 필수 필드이므로 중앙에 저장한다
--
-- 중앙에 두지 않는 것 (v1.0 §17.1)
--   이름 · 주민등록번호 · 연락처 · 이메일 · 주소 · 원서 본문 · 첨부파일 · 결제수단 상세
--   대학 원본 application id (opaque id 만 받는다)

CREATE SCHEMA IF NOT EXISTS kadmission_central;
SET search_path TO kadmission_central, public;

-- ── University Registry (v1.0 §3.1) ──────────────────────────────────────
CREATE TABLE university_registry (
  id varchar(32) PRIMARY KEY,
  name varchar(200) NOT NULL,
  apply_domain varchar(255),
  status varchar(20) NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 수신 이벤트 원장 ─────────────────────────────────────────────────────
-- dedup key 는 (source, event_id) 다. v1.1 §04 가 명시한다.
-- 같은 이벤트를 100번 받아도 상태는 한 번만 바뀐다.
CREATE TABLE received_event (
  id uuid PRIMARY KEY,
  source varchar(200) NOT NULL,
  event_id varchar(200) NOT NULL,
  event_type varchar(160) NOT NULL,
  university_id varchar(32) NOT NULL REFERENCES university_registry(id),
  -- 대학 원본 식별자가 아니라 opaque id 다. (v1.1 §A12)
  aggregate_id varchar(200) NOT NULL,
  aggregate_sequence bigint NOT NULL CHECK (aggregate_sequence > 0),
  config_version varchar(64),
  policy_version varchar(64),
  trace_id varchar(80),
  integrity_hash varchar(128) NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  receipt_id varchar(160) NOT NULL UNIQUE,
  UNIQUE (source, event_id)
);
CREATE INDEX idx_received_event_aggregate
  ON received_event(university_id, aggregate_id, aggregate_sequence);
CREATE INDEX idx_received_event_time ON received_event(received_at);

-- ── 내 원서 Dashboard 가 읽는 요약 (v1.1 §10 §9) ────────────────────────
-- 화면조회마다 대학 DB 를 호출하지 않는다. 이 테이블만 읽는다.
-- last_synced_at 을 항상 함께 보여준다 — 중앙은 언제나 뒤처질 수 있다. (v1.1 §A3)
CREATE TABLE application_summary (
  university_id varchar(32) NOT NULL REFERENCES university_registry(id),
  application_id varchar(200) NOT NULL,
  admission_year smallint NOT NULL,
  admission_type_code varchar(64) NOT NULL,
  department_code varchar(64) NOT NULL,
  status varchar(24) NOT NULL,
  application_number varchar(80),
  submitted_at timestamptz,
  -- 마지막으로 반영한 이벤트 sequence. 늦게 도착한 이벤트를 무시하는 기준이다.
  last_sequence bigint NOT NULL CHECK (last_sequence > 0),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (university_id, application_id)
);
CREATE INDEX idx_summary_year ON application_summary(admission_year, status);

-- ── Sequence Gap Detector (v1.1 §A3) ─────────────────────────────────────
-- sequence 가 건너뛰면 그 사이 이벤트가 유실됐다는 뜻이다.
-- 자동 복구되지 않으면 Reconciliation 대상이다.
CREATE TABLE sync_gap (
  id uuid PRIMARY KEY,
  university_id varchar(32) NOT NULL REFERENCES university_registry(id),
  aggregate_id varchar(200) NOT NULL,
  expected_sequence bigint NOT NULL,
  observed_sequence bigint NOT NULL,
  state varchar(20) NOT NULL CHECK (state IN ('OPEN','RESOLVED')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (university_id, aggregate_id, expected_sequence)
);
CREATE INDEX idx_sync_gap_open ON sync_gap(university_id, detected_at)
  WHERE state = 'OPEN';

-- ── 대학별 동기화 상태 (v1.0 §3.1 Incident Console) ──────────────────────
-- 관제 화면이 "어느 대학이 얼마나 밀려 있는가"를 본다.
CREATE TABLE university_sync_state (
  university_id varchar(32) PRIMARY KEY REFERENCES university_registry(id),
  platform_version varchar(64),
  config_version varchar(64),
  last_event_at timestamptz,
  last_heartbeat_at timestamptz,
  pending_outbox integer,
  oldest_pending_age_seconds integer,
  clock_offset_ms integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 지원자 참조 (불일치 대장 D-27) ───────────────────────────────────────
-- 요약만 가지고는 "내 원서" 를 추려줄 수 없다. 지원자 식별자가 없기 때문에
-- Dashboard 가 전체를 돌려주는 상태였다. 그건 조회가 아니라 유출이다.
--
-- 원문 대신 sha256(subject_token) 을 받는다. Vault 와 직접 조인되지 않으면서
-- 대학이 달라도 같은 사람이면 같은 값이 나온다.
ALTER TABLE application_summary ADD COLUMN subject_ref varchar(64);
CREATE INDEX idx_summary_subject ON application_summary(subject_ref, last_synced_at DESC);
