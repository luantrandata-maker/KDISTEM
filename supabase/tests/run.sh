#!/usr/bin/env bash
# Chạy toàn bộ migration trên một CSDL Postgres trống rồi chạy kiểm thử cách ly.
# Dùng: PGHOST=localhost PGUSER=postgres PGPASSWORD=... supabase/tests/run.sh [tên_csdl]
# CSDL đích sẽ bị XOÁ và tạo lại — không trỏ vào CSDL thật.
set -euo pipefail
DB=${1:-lms_test}
DIR=$(cd "$(dirname "$0")/.." && pwd)
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
$P -f "$DIR/tests/auth_stub.sql"
for f in "$DIR"/migrations/*.sql; do
  $P -f "$f" > /dev/null 2>&1 || { echo "Lỗi khi chạy $(basename "$f")"; $P -f "$f"; exit 1; }
  echo "ok $(basename "$f")"
done
OUT=$($P -At -f "$DIR/tests/isolation_test.sql")
echo "$OUT" | grep -E '^(PASS|FAIL) [0-9]+/[0-9]+$'
echo "$OUT" | grep '|FAIL|' || true
echo "$OUT" | grep -qE '^PASS [0-9]+/[0-9]+$'
