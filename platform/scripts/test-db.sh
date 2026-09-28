#!/usr/bin/env bash
# 로컬 PostgreSQL 에 빈 테스트 DB 를 만들고 마이그레이션 → 보안 테스트 → 이관 테스트를 차례로 돌린다.
# 운영 DB·구글 시트와 무관하다. 사용: PGURL=postgres://postgres@localhost:5432 platform/scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PGURL="${PGURL:-postgres://postgres@localhost:5432}"
DB="hakwon_test_$$"
psql "$PGURL/postgres" -q -c "create database $DB"
trap 'psql "$PGURL/postgres" -q -c "drop database if exists $DB" >/dev/null' EXIT
P="psql $PGURL/$DB -q -v ON_ERROR_STOP=1"
$P -f supabase/tests/00_local_supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "마이그레이션: $f"; $P -f "$f"; done
echo; echo "=== 보안 테스트 ==="
$P -f supabase/tests/10_security_test.sql 2>&1 | grep -E "PASS|FAIL|NOTICE|ERROR"
echo; echo "=== 이관 테스트 ==="
(cd migrate && DATABASE_URL="$PGURL/$DB" node test/run.mjs)
