#!/usr/bin/env bash
# Chạy toàn bộ migration trên CSDL Postgres trống rồi kiểm thử. Hai lượt:
#   1. Production: chạy migration KHÔNG bật cờ dữ liệu mẫu → kiểm tra CSDL sạch (tests/clean_check.sql).
#   2. Demo/kiểm thử: chạy migration CÓ bật cờ app.seed_demo=on → chạy kiểm thử cách ly (tests/isolation_test.sql).
# Dùng: PGHOST=localhost PGUSER=postgres PGPASSWORD=... supabase/tests/run.sh [tên_csdl]
# Các CSDL <tên>_clean và <tên> sẽ bị XOÁ và tạo lại — không trỏ vào CSDL thật.
set -euo pipefail
DB=${1:-lms_test}
DIR=$(cd "$(dirname "$0")/.." && pwd)

build() { # build <csdl> <cờ seed: on|off>
  local db=$1 seed=$2
  psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $db with (force)" -c "create database $db"
  local P="psql -v ON_ERROR_STOP=1 -q -d $db"
  $P -f "$DIR/tests/auth_stub.sql"
  for f in "$DIR"/migrations/*.sql; do
    PGOPTIONS="-c app.seed_demo=$seed" $P -f "$f" > /dev/null 2>&1 \
      || { echo "Lỗi khi chạy $(basename "$f") (seed=$seed)"; PGOPTIONS="-c app.seed_demo=$seed" $P -f "$f"; exit 1; }
  done
  echo "ok $(ls "$DIR"/migrations/*.sql | wc -l) migration (seed=$seed)"
}

# 1. Production: không có dữ liệu mẫu
build "${DB}_clean" off
CLEAN=$(psql -v ON_ERROR_STOP=1 -q -d "${DB}_clean" -f "$DIR/tests/clean_check.sql" 2>&1) \
  || { echo "$CLEAN" | grep -oE 'CLEAN FAIL.*'; exit 1; }
echo "$CLEAN" | grep -oE 'CLEAN PASS'
psql -q -d postgres -c "drop database if exists ${DB}_clean with (force)"

# 2. Demo: có dữ liệu mẫu + kiểm thử cách ly
build "$DB" on
OUT=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -At -f "$DIR/tests/isolation_test.sql")
echo "$OUT" | grep -E '^(PASS|FAIL) [0-9]+/[0-9]+$'
echo "$OUT" | grep '|FAIL|' || true
echo "$OUT" | grep -qE '^PASS [0-9]+/[0-9]+$'
