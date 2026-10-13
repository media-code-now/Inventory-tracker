\set ON_ERROR_STOP on
-- Read-only owner health check. Raises an error on ledger/balance drift or broken access controls.
begin read only;
do $$ begin
 if exists(select 1 from public.items i where i.quantity<>coalesce((select sum(b.quantity) from public.stock_balances b where b.item_id=i.id),0)) then raise exception 'Item totals disagree with location balances';end if;
 if exists(select 1 from public.stock_balances where quantity<0) then raise exception 'Negative stock exists';end if;
 if exists(select 1 from public.items i left join public.item_costs c on c.item_id=i.id where c.item_id is null) then raise exception 'Item missing admin cost record';end if;
 if exists(select 1 from public.stock_counts c join public.stock_count_lines l on l.count_id=c.id where c.state='completed' and l.adjustment_id is null) then raise exception 'Completed count missing adjustment ledger links';end if;
 if exists(select 1 from public.members m left join auth.users u on u.id=m.id where u.id is null) then raise exception 'Member missing Auth identity';end if;
 if not exists(select 1 from public.members where role='admin' and active) then raise exception 'No active admin';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('items','members','locations','movements','stock_balances','item_costs','invitations','stock_counts','stock_count_lines','stock_count_entries','inventory_imports','application_errors') and not c.relrowsecurity) then raise exception 'RLS disabled on protected table';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('items','movements','stock_balances','item_costs','stock_counts','stock_count_lines','stock_count_entries','inventory_imports','application_errors') and has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE')) then raise exception 'Browser has direct protected-table write permission';end if;
end $$;
select 'PASS: balance consistency, costs, count audit links, membership identities, active admin, RLS and protected-table permissions' as result;
commit;
