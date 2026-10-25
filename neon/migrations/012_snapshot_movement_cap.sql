-- Snapshots carry only the newest movements; full history is loaded on demand. Idempotency payloads are never sent to clients.
begin;
create index movement_recent on public.movements(created_at desc,id);

create function public.movement_history() returns jsonb language sql stable security invoker set search_path='' as $$
 select case when public.office_role() is null then null else
  coalesce((select jsonb_agg(to_jsonb(m)-'request_payload' order by m.created_at desc,m.id) from public.movements m),'[]'::jsonb) end
$$;
revoke all on function public.movement_history() from public,anon,authenticated;
grant execute on function public.movement_history() to authenticated;

-- 'issued' ranks non-reversed issues per item for each dashboard period, so the dashboard never needs full history.
create or replace function public.inventory_snapshot_before_counts() returns jsonb language sql stable security invoker set search_path='' as $$
 select case when public.office_role() is null then null else jsonb_build_object(
 'confirmed_at',statement_timestamp(),
 'items',coalesce((select jsonb_agg((to_jsonb(i)||jsonb_build_object('cost',c.cost)) order by i.name,i.id) from public.items i left join public.item_costs c on c.item_id=i.id),'[]'::jsonb),
 'balances',coalesce((select jsonb_agg(b order by b.item_id,b.location_id) from public.stock_balances b),'[]'::jsonb),
 'locations',coalesce((select jsonb_agg(l order by l.name,l.id) from public.locations l),'[]'::jsonb),
 'members',coalesce((select jsonb_agg(m order by m.name,m.id) from public.members m),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg(to_jsonb(m)-'request_payload' order by m.created_at desc,m.id) from (select * from public.movements order by created_at desc,id limit 500) m),'[]'::jsonb),
 'movements_complete',(select count(*)<=500 from (select 1 from public.movements limit 501) m),
 'issued',(select jsonb_object_agg(d,coalesce((select jsonb_agg(jsonb_build_object('item_id',r.item_id,'count',r.count,'quantity',r.quantity))
  from (select m.item_id,count(*) as count,sum(m.quantity) as quantity from public.movements m
   where m.kind='remove' and m.created_at>=statement_timestamp()-make_interval(days=>d) and m.created_at<=statement_timestamp()
   and not exists(select 1 from public.movements r where r.reverses_id=m.id) group by m.item_id) r),'[]'::jsonb))
  from unnest(array[7,30,90]) d),
 'invitations',coalesce((select jsonb_agg(i order by i.created_at desc,i.id) from public.invitations i),'[]'::jsonb),
 'alerts',coalesce((select jsonb_agg(a order by a.opened_at desc,a.id) from public.stock_alerts a where a.resolved_at is null),'[]'::jsonb)
 ) end
$$;
commit;
