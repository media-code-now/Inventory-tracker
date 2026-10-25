-- Policy helpers are security definer functions, which Postgres cannot inline, so a bare call runs once per row.
-- Wrapping each call in a scalar subquery makes it an InitPlan evaluated once per statement. Access rules are unchanged.
begin;
do $$ declare t record;begin
 for t in select schemaname,tablename from pg_policies where policyname='office_gate_required' loop
  execute format('alter policy office_gate_required on %I.%I using((select public.office_gate_valid())) with check((select public.office_gate_valid()))',t.schemaname,t.tablename);
 end loop;
end $$;

alter policy member_read on public.members using((select public.office_role()) is not null);
alter policy location_read on public.locations using((select public.office_role()) is not null);
alter policy location_create on public.locations with check((select public.office_role())='admin');
alter policy item_read on public.items using((select public.office_role()) is not null);
alter policy movement_read on public.movements using((select public.office_role()) is not null);
alter policy balance_read on public.stock_balances using((select public.office_role()) is not null);
alter policy alert_read on public.stock_alerts using((select public.office_role()) is not null);
alter policy count_read on public.stock_counts using((select public.office_role()) is not null);
alter policy line_read on public.stock_count_lines using((select public.office_role()) is not null);
alter policy entry_read on public.stock_count_entries using((select public.office_role()) is not null);
alter policy admin_invitation_read on public.invitations using((select public.office_role())='admin');
alter policy cost_admin_read on public.item_costs using((select public.office_role())='admin');
alter policy import_admin_read on public.inventory_imports using((select public.office_role())='admin');
alter policy diagnostics_admin_read on public.application_errors using((select public.office_role())='admin');

alter policy item_image_read on storage.objects using(
 bucket_id='item-images' and (select public.office_role()) is not null
 and ((select public.office_role())='admin' or exists(select 1 from public.items i where i.image_path=objects.name)));
alter policy item_image_upload on storage.objects with check(
 bucket_id='item-images' and (select public.office_role())='admin'
 and name~'^items/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');
alter policy item_image_orphan_cleanup on storage.objects using(
 bucket_id='item-images' and (select public.office_role())='admin'
 and not exists(select 1 from public.items i where i.image_path=objects.name));
-- The image policies look up items by image path.
create index item_image_path on public.items(image_path) where image_path is not null;
commit;
