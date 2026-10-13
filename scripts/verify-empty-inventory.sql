\set ON_ERROR_STOP on
-- Run only before the first office import. No demo inventory is seeded by migrations.
begin read only;
do $$ begin
 if exists(select 1 from public.items) or exists(select 1 from public.movements) or exists(select 1 from public.stock_balances) or exists(select 1 from public.stock_counts) or exists(select 1 from public.inventory_imports) then raise exception 'Inventory is not empty: confirm this is the intended fresh production project before onboarding';end if;
end $$;
select 'PASS: fresh production inventory contains no demo or test records' as result;
commit;
