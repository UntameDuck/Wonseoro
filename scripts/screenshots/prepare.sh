#!/usr/bin/env bash
# 화면 캡처 준비 — docs/screenshots/README.md 「다시 찍기」 순서대로 부른다.
#
#   db        캡처 전용 DB 컨테이너(ui-shots-pg :5497)를 만들거나 비우고 스키마·개발 시드를 넣는다
#             (서버를 모두 내린 뒤에 부른다 — 연결이 남아 있으면 DB 를 지울 수 없다)
#   policy    마감 정책을 콘솔 API 로 만든다 — 작성 officer1 → 승인 officer2·officer3 → 적용(서명 기록)
#   recon     중계기를 멈춘 채 접수한 원서(seed-recon 단계)의 미전송 이벤트 생성 시각을 31분 앞당긴다.
#             대조는 30분 넘게 중앙 확인이 없는 접수를 예외로 잡는다 — 30분을 기다리지 않으려는 것이다
#   config    설정 초안 cfg-2027-v2 를 만든다(내신 성적 삭제 · 지원 동기 추가) — 콘솔 검토 화면용
#
# 개발 시드 CI 판(ci-seed-deadline.sql)은 쓰지 않는다. 서명된 적용 기록이 없어 증적 화면이 경고를 띄운다.
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.."

PG=ui-shots-pg
P="docker exec -i $PG psql -q -U wonseoro -v ON_ERROR_STOP=1"
A=http://localhost:3101/admin/v1
CYCLE=11111111-1111-1111-1111-111111111111

post() { # post <경로> <담당자> <본문>
  curl -sf -X POST "$A/$1" -H "content-type: application/json" -H "x-admin-id: $2" \
    -H "idempotency-key: shots-$RANDOM-$RANDOM-$RANDOM" -d "$3"
}

case "${1:-}" in
  db)
    if ! docker ps --format '{{.Names}}' | grep -qx "$PG"; then
      docker run -d --name "$PG" -e POSTGRES_USER=wonseoro -e POSTGRES_PASSWORD=wonseoro -e POSTGRES_DB=univ_a \
        -p 5497:5432 postgres:16-alpine > /dev/null
      until docker exec "$PG" pg_isready -U wonseoro -d univ_a > /dev/null 2>&1; do sleep 1; done
      sleep 2
    fi
    $P -d postgres -c "DROP DATABASE IF EXISTS univ_a WITH (FORCE)" -c "DROP DATABASE IF EXISTS central WITH (FORCE)" \
      -c "CREATE DATABASE univ_a" -c "CREATE DATABASE central"
    for f in migrations/0001_init.sql migrations/0002_db_roles.sql migrations/0003_field_encryption.sql migrations/0004_break_glass.sql migrations/0005_outbox_archive.sql migrations/0006_writer_fence.sql migrations/0007_service_incident.sql migrations/0008_support_view.sql migrations/0009_privacy_request.sql migrations/0010_fee_refund_request.sql dev-roles.sql seed-dev.sql; do
      $P -d univ_a < "infra/db/$f" > /dev/null 2>&1 || { echo "실패: $f"; exit 1; }
    done
    # 두 번째 지원자 — 공통원서를 쓰지 않은 사람(검증 오류·취소·대조 예외 장면)
    $P -d univ_a -c "INSERT INTO kadmission.applicant (id, subject_token, pii_ciphertext, pii_key_version)
                     VALUES ('55555555-5555-5555-5555-555555555555', 'subj-dev-0002', '\x00', 'v1')"
    for f in 0001_init.sql 0002_vault.sql 0003_summary_names.sql 0004_vault_encryption.sql 0005_profile_collection_consent.sql; do $P -d central < "infra/db/central/$f" > /dev/null; done
    $P -d central -c "INSERT INTO kadmission_central.university_registry (id, name, status) VALUES ('UNIV-A', '원서로대학교', 'ACTIVE')"
    # 앞선 실행이 남긴 원서 ID 는 새 DB 에 없다
    # 캡처 작업 폴더는 저장소 .cache/shots (tests/a11y/helpers/workdir.mjs — C 드라이브 임시 폴더를 쓰지 않는다)
    rm -f "${WONSEORO_WORK_DIR:-.cache}/shots/state.json"
    echo "DB 준비 완료 (ui-shots-pg :5497 — univ_a · central)"
    ;;
  policy)
    ID=$(post deadline-policies officer1@univ-a \
      "{\"cycleId\":\"$CYCLE\",\"version\":\"2027-early-v1\",\"mode\":\"FINALIZED_COMMIT_BEFORE_DEADLINE\",\"deadlineAt\":\"2026-12-31T09:00:00Z\"}" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).policyId))")
    post "deadline-policies/$ID/approve" officer2@univ-a '{}' > /dev/null
    post "deadline-policies/$ID/approve" officer3@univ-a '{}' > /dev/null
    post "deadline-policies/$ID/activate" officer2@univ-a '{}' \
      | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('마감 정책 적용', j.activatedAt, '서명', j.activation.signature)})"
    ;;
  recon)
    $P -d univ_a -c "UPDATE kadmission.outbox_event SET created_at = created_at - interval '31 minutes' WHERE status <> 'SENT'"
    echo "미전송 이벤트 생성 시각을 31분 앞당겼다"
    ;;
  config)
    node -e "
      (async () => {
        const h = { 'content-type': 'application/json', 'x-admin-id': 'officer1@univ-a' };
        const active = await (await fetch('$A/config/active?cycleId=$CYCLE', { headers: h })).json();
        const config = structuredClone(active.config);
        delete config.forms.EARLY.properties.gpa;
        config.forms.EARLY.properties.motivation = { type: 'string', title: '지원 동기', maxLength: 500, 'x-multiline': true };
        const r = await fetch('$A/config/versions', {
          method: 'POST',
          headers: { ...h, 'idempotency-key': 'shots-cfg-' + Date.now() },
          body: JSON.stringify({ cycleId: '$CYCLE', version: 'cfg-2027-v2', config }),
        });
        console.log('설정 초안', r.status, (await r.json()).version);
      })();"
    ;;
  *)
    echo "사용: $0 db|policy|recon|config" >&2
    exit 2
    ;;
esac
