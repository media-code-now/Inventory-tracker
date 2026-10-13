#!/bin/sh
set -eu
TEST_DIR=$(mktemp -d /tmp/stockroom-db.XXXXXX)
trap 'pg_ctl -D "$TEST_DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TEST_DIR"' EXIT
initdb -D "$TEST_DIR/data" -A trust >/dev/null
pg_ctl -D "$TEST_DIR/data" -l "$TEST_DIR/server.log" -o "-k $TEST_DIR -p 55439 -c listen_addresses=''" start >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -f scripts/test-bootstrap.sql >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/001_inventory.sql >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -f scripts/test-permissions.sql
