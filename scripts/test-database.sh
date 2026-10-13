#!/bin/sh
set -eu
TEST_DIR=$(mktemp -d /tmp/stockroom-db.XXXXXX)
trap 'pg_ctl -D "$TEST_DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TEST_DIR"' EXIT
initdb -D "$TEST_DIR/data" -A trust >/dev/null
pg_ctl -D "$TEST_DIR/data" -l "$TEST_DIR/server.log" -o "-k $TEST_DIR -p 55439 -c listen_addresses='' -c wal_level=logical" start >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -f scripts/test-bootstrap.sql >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/001_inventory.sql >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/002_invitation_access.sql >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/003_item_management.sql >/dev/null
# Exercise the actual trusted-owner bootstrap before the normal fixtures exist.
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -c "insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-000000000010','bootstrap@example.test',now());" >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -v admin_user_id=00000000-0000-0000-0000-000000000010 -v admin_name='Bootstrap Admin' -f scripts/bootstrap-admin.sql >/dev/null
if psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -v admin_user_id=00000000-0000-0000-0000-000000000010 -v admin_name='Bootstrap Admin' -f scripts/bootstrap-admin.sql >"$TEST_DIR/bootstrap-repeat.log" 2>&1; then
  echo 'FAIL: bootstrap allowed a second active admin bootstrap' >&2
  exit 1
fi
rg -q 'An active admin already exists' "$TEST_DIR/bootstrap-repeat.log"
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -c "delete from members where id='00000000-0000-0000-0000-000000000010'; delete from auth.users where id='00000000-0000-0000-0000-000000000010';" >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -q -f scripts/test-permissions.sql
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -q -f scripts/test-invitation-access.sql

psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -q -f scripts/test-item-management.sql

psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/004_transactions.sql >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -q -f scripts/test-transactions.sql
python3 scripts/test-concurrent-transactions.py "$TEST_DIR" 55439

psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/005_inventory_snapshot.sql >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -q -f scripts/test-inventory-snapshot.sql
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/006_dashboard_alerts.sql >/dev/null
psql -h "$TEST_DIR" -p 55439 -d postgres -v ON_ERROR_STOP=1 -q -f scripts/test-stock-alerts.sql
