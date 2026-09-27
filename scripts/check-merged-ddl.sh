#!/usr/bin/env bash
# 병합 DDL 이 마이그레이션 체인과 같은 스키마를 만드는지 확인한다.
#
# 노션 §02 첨부를 infra/db/k-admission-postgresql-ddl.v1.2.sql 로 바꾸기 전에 돌린다.
# 빈 DB 두 개에 각각 (0001→0006 체인) 과 (병합 DDL) 을 깔고 pg_dump -s 결과를 비교한다.
# 소유자·권한은 환경마다 다르므로 비교하지 않는다 (-O -x). 역할은 0004 가 따로 맡는다.
#
# 실행: bash scripts/check-merged-ddl.sh
set -euo pipefail
cd "$(dirname "$0")/.."

C=wonseoro-dev-postgres-univ-a-1
PSQL=(docker exec -i "$C" psql -U wonseoro -v ON_ERROR_STOP=1 -q)
TMP=$(mktemp -d)
trap 'docker exec "$C" psql -U wonseoro -d postgres -qc "DROP DATABASE IF EXISTS ddl_chain" -c "DROP DATABASE IF EXISTS ddl_merged" >/dev/null; rm -rf "$TMP"' EXIT

for db in ddl_chain ddl_merged; do
  docker exec "$C" psql -U wonseoro -d postgres -qc "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null
done

for f in infra/db/migrations/000[1-9]_*.sql; do
  "${PSQL[@]}" -d ddl_chain < "$f" >/dev/null 2>&1 || { echo "체인 적용 실패: $f"; exit 1; }
done
"${PSQL[@]}" -d ddl_merged < infra/db/k-admission-postgresql-ddl.v1.2.sql >/dev/null 2>&1

dump() { docker exec "$C" pg_dump -U wonseoro -s -O -x -n kadmission "$1" | grep -Ev '^.(un)?restrict '; }
dump ddl_chain > "$TMP/chain.sql"
dump ddl_merged > "$TMP/merged.sql"

if diff -u "$TMP/chain.sql" "$TMP/merged.sql"; then
  echo "같다 — 병합 DDL 이 체인과 같은 스키마를 만든다 ($(wc -l < "$TMP/chain.sql") 줄)"
else
  echo "다르다 — 위 diff 를 보고 병합 DDL 을 고친다"
  exit 1
fi
