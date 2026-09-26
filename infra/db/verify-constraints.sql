-- 정합성 제약 행동 검증 (T-M1-01 인수)
--
-- DDL 에 제약이 "존재하는지"가 아니라 "실제로 막는지"를 확인한다.
-- 접수 중복·이벤트 중복·단독 승인은 코드가 아니라 DB 가 막아야 한다.
--
-- 실행: docker exec -i wonseoro-dev-postgres-univ-a-1 \
--         psql -U wonseoro -d univ_a -v ON_ERROR_STOP=1 < infra/db/verify-constraints.sql

SET search_path TO kadmission, public;

BEGIN;

-- ── 시드 ──────────────────────────────────────────────────────────────
-- 개발 DB 위에서도 그대로 돌아야 한다. 같은 id 가 이미 있으면 건너뛴다.
-- 스크립트 전체가 ROLLBACK 으로 끝나므로 기존 데이터는 바뀌지 않는다.
INSERT INTO university (id, name, status)
VALUES ('UNIV-A', '검증대학교', 'ACTIVE') ON CONFLICT (id) DO NOTHING;

INSERT INTO admission_cycle (id, university_id, admission_year, name, opens_at, closes_at, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'UNIV-A', 2027, '2027 수시',
        '2026-09-01T00:00:00Z', '2026-09-11T09:00:00Z', 'OPEN') ON CONFLICT (id) DO NOTHING;

-- 설정·마감정책 검증용 별도 전형.
-- 개발 DB 에 이미 활성 설정이 있는 전형을 쓰면 검증이 엉뚱한 곳에서 걸린다.
INSERT INTO admission_cycle (id, university_id, admission_year, name, opens_at, closes_at, status)
VALUES ('99999999-9999-9999-9999-999999999999', 'UNIV-A', 2028, '2028 검증용',
        '2027-09-01T00:00:00Z', '2027-09-11T09:00:00Z', 'OPEN') ON CONFLICT (id) DO NOTHING;

INSERT INTO admission_type (id, cycle_id, code, name, fee_amount)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'EARLY', '학생부종합', 55000) ON CONFLICT (id) DO NOTHING;

INSERT INTO department (id, cycle_id, code, name, quota)
VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
        'CSE', '컴퓨터공학과', 40) ON CONFLICT (id) DO NOTHING;

INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
VALUES ('4a4a4a4a-4444-4444-4444-444444444444', 'subj-constraint-verify', '\x00', 'v1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
        '4a4a4a4a-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333', 'PAID') ON CONFLICT (id) DO NOTHING;

-- ── 1. 중복 접수 차단 (submission.application_id UNIQUE) ───────────────
-- v1.1 §01 E: "동일 Finalize 100회 재시도 → Submission 1건"
DO $$
DECLARE blocked boolean := false;
BEGIN
  INSERT INTO submission (id, application_id, application_number, requested_at,
                          payment_verified_at, finalized_at, deadline_policy_version,
                          config_version, evidence_hash)
  VALUES ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555',
          '2027-A-000001', now(), now(), now(), 'p-v1', 'c-v1', 'h1');
  BEGIN
    INSERT INTO submission (id, application_id, application_number, requested_at,
                            payment_verified_at, finalized_at, deadline_policy_version,
                            config_version, evidence_hash)
    VALUES ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555',
            '2027-A-000002', now(), now(), now(), 'p-v1', 'c-v1', 'h2');
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  RAISE NOTICE '1. 중복 Submission 차단: %', CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END;
  ASSERT blocked, '같은 원서에 Submission 이 두 건 생성되었다';
END $$;

-- ── 2. 접수번호 중복 차단 (application_number UNIQUE) ──────────────────
DO $$
DECLARE blocked boolean := false;
BEGIN
  INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
  VALUES ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111',
          '4a4a4a4a-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333', 'PAID')
  ON CONFLICT DO NOTHING;
  BEGIN
    INSERT INTO submission (id, application_id, application_number, requested_at,
                            payment_verified_at, finalized_at, deadline_policy_version,
                            config_version, evidence_hash)
    VALUES ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888',
            '2027-A-000001', now(), now(), now(), 'p-v1', 'c-v1', 'h3');
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  RAISE NOTICE '2. 접수번호 중복 차단: %', CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END;
  ASSERT blocked, '접수번호가 중복 발급되었다';
END $$;

-- ── 3. 이벤트 중복·순서 보장 (aggregate_id, aggregate_sequence) ────────
-- v1.1 §A3: sequence gap 탐지의 전제
DO $$
DECLARE blocked boolean := false;
BEGIN
  INSERT INTO outbox_event (id, aggregate_id, aggregate_sequence, event_type,
                            schema_version, payload, payload_hash)
  VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555', 1,
          'kr.kadmission.application.finalized.v1', 'v1', '{}'::jsonb, 'h');
  BEGIN
    INSERT INTO outbox_event (id, aggregate_id, aggregate_sequence, event_type,
                              schema_version, payload, payload_hash)
    VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555', 1,
            'kr.kadmission.application.finalized.v1', 'v1', '{}'::jsonb, 'h');
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  RAISE NOTICE '3. Outbox sequence 중복 차단: %', CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END;
  ASSERT blocked, '같은 sequence 이벤트가 두 건 생성되었다';
END $$;

-- ── 4. PG 거래 재사용 차단 (provider, provider_tx_id) ──────────────────
-- v1.1 §09 고위험 Abuse Case: "동일 PG 거래 재사용"
DO $$
DECLARE blocked boolean := false;
BEGIN
  INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status)
  VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555', 'mock-pg', 'TX-1', 55000, 'CONFIRMED');
  BEGIN
    INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status)
    VALUES (gen_random_uuid(), '88888888-8888-8888-8888-888888888888', 'mock-pg', 'TX-1', 55000, 'CONFIRMED');
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  RAISE NOTICE '4. PG 거래 재사용 차단: %', CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END;
  ASSERT blocked, '같은 PG 거래가 두 원서에 재사용되었다';
END $$;

-- ── 5. 단독 승인 차단 (approved_by_1 <> approved_by_2) ─────────────────
-- v1.1 §01 E: "단독 운영자 1명으로 마감시간 변경 불가"
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO deadline_policy (id, cycle_id, version, mode, deadline_at,
                                 approved_by_1, approved_by_2, approved_at,
                                 policy_hash, immutable_snapshot)
    VALUES (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'v1',
            'FINALIZED_COMMIT_BEFORE_DEADLINE', '2026-09-11T09:00:00Z',
            'admin@univ-a', 'admin@univ-a', now(), 'h', '{}'::jsonb);
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  RAISE NOTICE '5. 단독 승인 마감정책 차단: %', CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END;
  ASSERT blocked, '한 사람이 마감정책을 단독 승인할 수 있다';
END $$;

-- ── 6. 허용되지 않은 상태값 차단 (application.status CHECK) ────────────
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    UPDATE application SET status = 'WHATEVER'
     WHERE id = '55555555-5555-5555-5555-555555555555';
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  RAISE NOTICE '6. 미정의 상태값 차단: %', CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END;
  ASSERT blocked, '상태머신에 없는 값이 DB 에 들어갔다';
END $$;

-- ── 7. 조건부 전이 (v1.1 §B3 — 읽고-검사하고-쓰기 금지) ────────────────
-- 같은 전이를 두 번 시도하면 두 번째는 0건이어야 한다.
DO $$
DECLARE first_rows int; second_rows int;
BEGIN
  UPDATE application SET status = 'FINALIZING', version = version + 1
   WHERE id = '55555555-5555-5555-5555-555555555555'
     AND status = 'PAID' AND version = 1;
  GET DIAGNOSTICS first_rows = ROW_COUNT;

  UPDATE application SET status = 'FINALIZING', version = version + 1
   WHERE id = '55555555-5555-5555-5555-555555555555'
     AND status = 'PAID' AND version = 1;
  GET DIAGNOSTICS second_rows = ROW_COUNT;

  RAISE NOTICE '7. 조건부 전이 (1회차 %건, 2회차 %건): %',
    first_rows, second_rows,
    CASE WHEN first_rows = 1 AND second_rows = 0 THEN 'PASS' ELSE 'FAIL' END;
  ASSERT first_rows = 1 AND second_rows = 0, '조건부 전이가 중복 적용되었다';
END $$;

-- ── 8. 승인 없는 설정 활성화 차단 (D-21 / 0002) ────────────────────────
-- 원서 양식과 전형료가 config_version 안에 있다.
-- 승인 0명으로 ACTIVE 가 되면 아무도 모르게 전형료가 바뀔 수 있다.
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO config_version (id, cycle_id, version, status, config_json,
                                config_hash, created_by, activated_at)
    VALUES (gen_random_uuid(), '99999999-9999-9999-9999-999999999999',
            'v-probe-1', 'ACTIVE', '{}', 'h', 'admin1@univ-a', now());
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  RAISE NOTICE '8. 승인 0명 설정 활성화 차단: %', CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END;
  ASSERT blocked, '승인 없이 원서 양식을 바꿀 수 있다';
END $$;

-- ── 9. 작성자 자기승인 차단 (v1.1 §A14 / D-21) ─────────────────────────
-- 만든 사람이 승인까지 하면 2인 승인은 형식만 남는다.
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO config_version (id, cycle_id, version, status, config_json,
                                config_hash, created_by, approved_by_1, approved_by_2,
                                activated_at)
    VALUES (gen_random_uuid(), '99999999-9999-9999-9999-999999999999',
            'v-probe-2', 'ACTIVE', '{}', 'h',
            'admin1@univ-a', 'admin1@univ-a', 'admin2@univ-a', now());
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  RAISE NOTICE '9. 작성자 자기승인 차단: %', CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END;
  ASSERT blocked, '작성자가 자기 변경을 승인할 수 있다';
END $$;

-- ── 10. 전형당 ACTIVE 설정은 하나 (D-21 / 0002) ────────────────────────
-- 둘이면 어느 양식이 적용되는지가 조회 순서에 달린다.
DO $$
DECLARE blocked boolean := false;
BEGIN
  INSERT INTO config_version (id, cycle_id, version, status, config_json,
                              config_hash, created_by, approved_by_1, approved_by_2,
                              approved_at, activated_at)
  VALUES (gen_random_uuid(), '99999999-9999-9999-9999-999999999999',
          'v-probe-3', 'ACTIVE', '{}', 'h',
          'admin1@univ-a', 'admin2@univ-a', 'admin3@univ-a', now(), now());
  BEGIN
    INSERT INTO config_version (id, cycle_id, version, status, config_json,
                                config_hash, created_by, approved_by_1, approved_by_2,
                                approved_at, activated_at)
    VALUES (gen_random_uuid(), '99999999-9999-9999-9999-999999999999',
            'v-probe-4', 'ACTIVE', '{}', 'h',
            'admin1@univ-a', 'admin2@univ-a', 'admin3@univ-a', now(), now());
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  RAISE NOTICE '10. 전형당 ACTIVE 설정 1건: %', CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END;
  ASSERT blocked, '한 전형에 활성 설정이 둘이 됐다';
END $$;

-- ── 11. 같은 불일치 중복 등록 차단 (D-25 / 0002) ───────────────────────
-- 대조는 주기적으로 돈다. 매 실행마다 쌓이면 큐를 읽을 수 없고,
-- 읽을 수 없는 큐는 없는 큐다.
DO $$
DECLARE blocked boolean := false; reopened boolean := false;
BEGIN
  INSERT INTO reconciliation_exception (id, application_id, exception_type,
                                        severity, state, facts)
  VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555',
          'PROBE_TYPE', 'HIGH', 'OPEN', '{}');
  BEGIN
    INSERT INTO reconciliation_exception (id, application_id, exception_type,
                                          severity, state, facts)
    VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555',
            'PROBE_TYPE', 'HIGH', 'OPEN', '{}');
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  RAISE NOTICE '11. 미해결 불일치 중복 차단: %', CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END;
  ASSERT blocked, '같은 불일치가 실행마다 쌓인다';

  -- 다만 해소된 뒤의 재발은 새 사건이다. 이것까지 막으면 두 번째 사고를 놓친다.
  UPDATE reconciliation_exception
     SET state = 'RESOLVED', resolved_at = now(), resolution_code = 'PROBE',
         resolved_by = 'verifier'
   WHERE application_id = '55555555-5555-5555-5555-555555555555'
     AND exception_type = 'PROBE_TYPE';
  INSERT INTO reconciliation_exception (id, application_id, exception_type,
                                        severity, state, facts)
  VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555',
          'PROBE_TYPE', 'HIGH', 'OPEN', '{}');
  reopened := true;
  RAISE NOTICE '11b. 해소 후 재발 등록 허용: %', CASE WHEN reopened THEN 'PASS' ELSE 'FAIL' END;
  ASSERT reopened, '재발한 불일치를 등록할 수 없다';
END $$;

-- ── 13. 활성화 기록 — 추가만 가능하다 (0003, D-35) ─────────────────────
-- 연장·되돌리기의 "누가 언제 왜" 가 고쳐지거나 지워지면 불변 기록이 아니다.
DO $$
DECLARE rec uuid := gen_random_uuid();
        upd boolean := false; del boolean := false; nodecision boolean := false;
BEGIN
  INSERT INTO activation_record (id, cycle_id, subject_type, subject_id, subject_version, kind,
                                 effective_at, operator_id, reason, decision_ref,
                                 payload, payload_hash, signature, key_id)
  VALUES (rec, '99999999-9999-9999-9999-999999999999', 'DEADLINE_POLICY', gen_random_uuid(),
          'verify-ext1', 'EXTEND', now(), 'verifier', '검증', '입학처-검증-1',
          '{}', 'h', 's', 'k');
  BEGIN
    UPDATE activation_record SET reason = '조작' WHERE id = rec;
  EXCEPTION WHEN insufficient_privilege THEN upd := true;
  END;
  BEGIN
    DELETE FROM activation_record WHERE id = rec;
  EXCEPTION WHEN insufficient_privilege THEN del := true;
  END;
  RAISE NOTICE '13. 활성화 기록 수정·삭제 차단: %', CASE WHEN upd AND del THEN 'PASS' ELSE 'FAIL' END;
  ASSERT upd AND del, '활성화 기록을 고치거나 지울 수 있다';

  -- 연장은 입학처 결정 문서번호 없이 기록될 수 없다. 기술팀이 결정하지 않는다. (§B17)
  BEGIN
    INSERT INTO activation_record (id, cycle_id, subject_type, subject_id, subject_version, kind,
                                   effective_at, operator_id, reason, payload, payload_hash,
                                   signature, key_id)
    VALUES (gen_random_uuid(), '99999999-9999-9999-9999-999999999999', 'DEADLINE_POLICY',
            gen_random_uuid(), 'verify-ext2', 'EXTEND', now(), 'verifier', '검증',
            '{}', 'h', 's', 'k');
  EXCEPTION WHEN check_violation THEN nodecision := true;
  END;
  RAISE NOTICE '14. 결정번호 없는 연장 기록 차단: %', CASE WHEN nodecision THEN 'PASS' ELSE 'FAIL' END;
  ASSERT nodecision, '결정 근거 없는 연장이 기록된다';
END $$;

ROLLBACK;
