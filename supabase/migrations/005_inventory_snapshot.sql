begin;
-- One statement/snapshot, executed with the caller's RLS permissions, never service-role privileges.
create function public.inventory_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select case when public.office_role() is null then null else jsonb_build_object(
  'confirmed_at',statement_timestamp(),
  'items',coalesce((select jsonb_agg(i order by i.name,i.id) from public.items i),'[]'::jsonb),
  'balances',coalesce((select jsonb_agg(b order by b.item_id,b.location_id) from public.stock_balances b),'[]'::jsonb),
  'locations',coalesce((select jsonb_agg(l order by l.name,l.id) from public.locations l),'[]'::jsonb),
  'members',coalesce((select jsonb_agg(m order by m.name,m.id) from public.members m),'[]'::jsonb),
  'movements',coalesce((select jsonb_agg(m order by m.created_at desc,m.id) from public.movements m),'[]'::jsonb),
  'invitations',coalesce((select jsonb_agg(i order by i.created_at desc,i.id) from public.invitations i),'[]'::jsonb)
 ) end
$$;
revoke all on function public.inventory_snapshot() from public,anon,authenticated;
grant execute on function public.inventory_snapshot() to authenticated;
commit;
