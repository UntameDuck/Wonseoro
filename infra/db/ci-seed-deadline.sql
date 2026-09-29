-- CI 전용 — 개발 시드 주기에 활성 마감정책 하나를 둔다. 운영·로컬 개발 DB 에는 적용하지 않는다.
--
-- 로컬 DB 는 관리자 콘솔의 2인 승인·서명된 활성화로 정책을 만들었다(D-21·D-23). CI 는 빈 DB 에서
-- 시작하므로 통합 시험이 기대는 "활성 정책" 을 여기서 바로 넣는다. 제약(2인 승인·자기승인 금지·
-- 활성화 상태)은 그대로 통과해야 한다. 마감은 먼 미래로 둬 날짜가 지나도 시험이 깨지지 않게 한다.
--
-- 실행: .github/workflows/ci.yml (seed-dev.sql 다음)

SET search_path TO kadmission, public;

INSERT INTO deadline_policy
  (id, cycle_id, version, mode, deadline_at, approved_by_1, approved_by_2, approved_at,
   activated_at, policy_hash, immutable_snapshot, status, created_by)
VALUES
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'ci-2027-v1',
   'FINALIZED_COMMIT_BEFORE_DEADLINE', '2099-12-31T09:00:00Z', 'ci-approver-1', 'ci-approver-2',
   now() - interval '1 day', now() - interval '1 day', 'ci-seed',
   '{"source":"ci-seed-deadline.sql"}'::jsonb, 'ACTIVATED', 'ci-author')
ON CONFLICT (cycle_id, version) DO NOTHING;
