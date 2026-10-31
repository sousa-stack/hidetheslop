#!/usr/bin/env bash
# Runs the migrations and tests on a throwaway Postgres, or on TEST_DATABASE_URL if set.
set -euo pipefail

cd "$(dirname "$0")/.."

PG_BIN=/opt/homebrew/opt/postgresql@18/bin
PORT=54329
DATA_DIR=""

cleanup() {
  if [ -n "$DATA_DIR" ]; then
    "$PG_BIN/pg_ctl" -D "$DATA_DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
    rm -rf "$DATA_DIR"
  fi
}
trap cleanup EXIT

if [ -z "${TEST_DATABASE_URL:-}" ]; then
  DATA_DIR="$(mktemp -d)"
  # Without LC_ALL and the empty socket directory, Postgres fails to start on this Mac.
  export LC_ALL=en_US.UTF-8
  "$PG_BIN/initdb" -D "$DATA_DIR/data" -U postgres --auth=trust >/dev/null
  "$PG_BIN/pg_ctl" -D "$DATA_DIR/data" -l "$DATA_DIR/postgres.log" -w \
    -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres hidetheslop_test
  export TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/hidetheslop_test"
fi

# The tests refuse a database without `test` in its name, but the migrations run first.
db_name="${TEST_DATABASE_URL##*/}"
case "${db_name%%\?*}" in
  *test*) ;;
  *) echo "Refusing: the database name must contain 'test'." >&2; exit 1 ;;
esac

DATABASE_URL="$TEST_DATABASE_URL" npm run --silent migrate
npm test
