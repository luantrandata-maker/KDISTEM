#!/usr/bin/env bash
# Chạy toàn bộ migration trên CSDL Postgres trống rồi kiểm thử. Hai lượt:
#   1. Production: chạy migration KHÔNG bật cờ dữ liệu mẫu → kiểm tra CSDL sạch (tests/clean_check.sql).
#   2. Demo/kiểm thử: chạy migration CÓ bật cờ app.seed_demo=on → chạy kiểm thử cách ly (tests/isolation_test.sql).
# Dùng: PGHOST=localhost PGUSER=postgres PGPASSWORD=... supabase/tests/run.sh [tên_csdl]
# Các CSDL <tên>_clean và <tên> sẽ bị XOÁ và tạo lại — không trỏ vào CSDL thật.
set -euo pipefail
DB=${1:-lms_test}
trap 'rc=$?; if [ $rc -ne 0 ] && [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error title=run.sh::thoát mã $rc ở dòng $LINENO: $BASH_COMMAND"; fi' EXIT
DIR=$(cd "$(dirname "$0")/.." && pwd)
# Trong GitHub Actions: in lỗi thành annotation (đọc được qua API, không cần mở log).
ann() { if [ -n "${GITHUB_ACTIONS:-}" ]; then printf '::error title=%s::%s\n' "$1" "$(printf '%s' "$2" | tr '\n' ' ' | cut -c1-900)"; fi; }

build() { # build <csdl> <cờ seed: on|off>
  local db=$1 seed=$2
  psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $db with (force)" -c "create database $db"
  local P="psql -v ON_ERROR_STOP=1 -q -d $db"
  $P -f "$DIR/tests/auth_stub.sql"
  for f in "$DIR"/migrations/*.sql; do
    if ! ERR=$(PGOPTIONS="-c app.seed_demo=$seed" $P -f "$f" 2>&1 > /dev/null); then
      echo "Lỗi khi chạy $(basename "$f") (seed=$seed)"; echo "$ERR" | grep -v NOTICE
      ann "migration $(basename "$f") seed=$seed" "$(echo "$ERR" | grep -v NOTICE | tail -5)"; exit 1
    fi
  done
  echo "ok $(ls "$DIR"/migrations/*.sql | wc -l) migration (seed=$seed)"
}

# 1. Production: không có dữ liệu mẫu
build "${DB}_clean" off
CLEAN=$(psql -v ON_ERROR_STOP=1 -q -d "${DB}_clean" -f "$DIR/tests/clean_check.sql" 2>&1) \
  || { echo "$CLEAN" | grep -oE 'CLEAN FAIL.*'; ann "clean_check" "$(echo "$CLEAN" | grep -v NOTICE | tail -3)"; exit 1; }
echo "$CLEAN" | grep -oE 'CLEAN PASS'
psql -q -d postgres -c "drop database if exists ${DB}_clean with (force)"

# 2. Demo: có dữ liệu mẫu + kiểm thử cách ly
build "$DB" on
if ! OUT=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -At -f "$DIR/tests/isolation_test.sql" 2>&1); then
  echo "$OUT" | grep -v NOTICE | tail -10
  ann "isolation_test.sql lỗi SQL" "$(echo "$OUT" | grep -v NOTICE | grep -iE 'error|psql:' | tail -3)"; exit 1
fi
echo "$OUT" | grep -E '^(PASS|FAIL) [0-9]+/[0-9]+$'
echo "$OUT" | grep '|FAIL|' || true
{ echo "$OUT" | grep '|FAIL|' || true; } | head -10 | while IFS= read -r l; do ann "phép thử đỏ" "$l"; done
# Không dùng `echo | grep -q` với pipefail: grep -q thoát ngay khi khớp, echo nhận SIGPIPE (mã 141) và cả pipeline
# bị tính là lỗi dù đã PASS — đây là nguyên nhân kiểm thử "đỏ không rõ lý do" trên main (OUT lớn, ghi chưa xong thì grep đã thoát).
if ! grep -qE '^PASS [0-9]+/[0-9]+$' <<< "$OUT"; then
  # Không có dòng PASS: ghi dòng tổng và vài dòng cuối để đọc được qua annotation (điều tra lỗi chập chờn)
  ann "isolation_test.sql không PASS" "tổng: $(echo "$OUT" | grep -E '^(PASS|FAIL) [0-9]+/[0-9]+$' || echo 'không có dòng tổng') · cuối: $(echo "$OUT" | grep -v NOTICE | tail -4)"
  exit 1
fi
