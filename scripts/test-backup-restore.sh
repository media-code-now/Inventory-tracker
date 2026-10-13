#!/bin/sh
set -eu
TEST_HOST=$1
TEST_PORT=$2
# Disposable local test cluster only. This is not a managed Supabase restore command.
pg_dump -h "$TEST_HOST" -p "$TEST_PORT" -d postgres --format=custom --no-owner --file="$TEST_HOST/office-backup.dump"
createdb -h "$TEST_HOST" -p "$TEST_PORT" stockroom_restore_test
pg_restore -h "$TEST_HOST" -p "$TEST_PORT" -d stockroom_restore_test --no-owner --exit-on-error "$TEST_HOST/office-backup.dump"
psql -h "$TEST_HOST" -p "$TEST_PORT" -d stockroom_restore_test -v ON_ERROR_STOP=1 -q -f scripts/operational-check.sql
# Compare complete application data and Auth/Storage metadata, independent of table ordering.
CHECKSUM_SQL="select md5(string_agg(data,'|' order by name)) from ("
for TEST_TABLE in public.members public.locations public.items public.item_costs public.stock_balances public.movements public.invitations public.stock_alerts public.stock_counts public.stock_count_lines public.stock_count_entries public.inventory_imports public.application_errors auth.users storage.buckets storage.objects; do
 if [ "$TEST_TABLE" != public.members ]; then CHECKSUM_SQL="$CHECKSUM_SQL union all "; fi
 CHECKSUM_SQL="$CHECKSUM_SQL select '$TEST_TABLE' as name,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]') as data from $TEST_TABLE t"
done
CHECKSUM_SQL="$CHECKSUM_SQL) contents;"
BEFORE_CHECKSUM=$(psql -h "$TEST_HOST" -p "$TEST_PORT" -d postgres -At -c "$CHECKSUM_SQL")
AFTER_CHECKSUM=$(psql -h "$TEST_HOST" -p "$TEST_PORT" -d stockroom_restore_test -At -c "$CHECKSUM_SQL")
[ "$BEFORE_CHECKSUM" = "$AFTER_CHECKSUM" ] || { echo 'FAIL: restored data differs' >&2; exit 1; }
# Restored policies still deny costs to staff, with an existing authenticated JWT subject.
psql -h "$TEST_HOST" -p "$TEST_PORT" -d stockroom_restore_test -v ON_ERROR_STOP=1 -q -c "set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);do \$\$ begin if exists(select 1 from public.item_costs) then raise exception 'Restored cost policies leak';end if;if public.inventory_snapshot() is null then raise exception 'Restored active member denied';end if;end \$\$;" >/dev/null
echo 'PASS: local full database backup restored with identical application/Auth/Storage metadata, invariant checks and staff cost denial'
