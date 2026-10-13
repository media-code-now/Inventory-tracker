begin;
create table public.stock_alerts(
 id uuid primary key default gen_random_uuid(),item_id uuid not null references public.items(id),
 condition text not null check(condition in ('low_stock','out_of_stock')),
 opened_at timestamptz not null default now(),resolved_at timestamptz,
 check(resolved_at is null or resolved_at>=opened_at)
);
create unique index one_unresolved_stock_alert on public.stock_alerts(item_id) where resolved_at is null;
alter table public.stock_alerts enable row level security;
create policy alert_read on public.stock_alerts for select to authenticated using(public.office_role() is not null);
revoke all on public.stock_alerts from public,anon,authenticated;
grant select on public.stock_alerts to authenticated;
create function public.sync_stock_alert() returns trigger language plpgsql security definer set search_path='' as $$
declare current_condition text;
begin
 current_condition:=case when new.status<>'active' then null when new.quantity=0 then 'out_of_stock' when new.quantity<=new.minimum then 'low_stock' else null end;
 update public.stock_alerts set resolved_at=clock_timestamp() where item_id=new.id and resolved_at is null and (current_condition is null or condition<>current_condition);
 if current_condition is not null then
  insert into public.stock_alerts(item_id,condition) values(new.id,current_condition) on conflict(item_id) where resolved_at is null do nothing;
 end if;
 return new;
end $$;
revoke all on function public.sync_stock_alert() from public,anon,authenticated;
create trigger item_stock_alert after insert or update of quantity,minimum,status on public.items for each row execute function public.sync_stock_alert();
insert into public.stock_alerts(item_id,condition) select id,case when quantity=0 then 'out_of_stock' else 'low_stock' end from public.items where status='active' and quantity<=minimum;
alter publication supabase_realtime add table public.stock_alerts;
create or replace function public.inventory_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select case when public.office_role() is null then null else jsonb_build_object(
 'confirmed_at',statement_timestamp(),
 'items',coalesce((select jsonb_agg(i order by i.name,i.id) from public.items i),'[]'::jsonb),
 'balances',coalesce((select jsonb_agg(b order by b.item_id,b.location_id) from public.stock_balances b),'[]'::jsonb),
 'locations',coalesce((select jsonb_agg(l order by l.name,l.id) from public.locations l),'[]'::jsonb),
 'members',coalesce((select jsonb_agg(m order by m.name,m.id) from public.members m),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg(m order by m.created_at desc,m.id) from public.movements m),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(i order by i.created_at desc,i.id) from public.invitations i),'[]'::jsonb),
 'alerts',coalesce((select jsonb_agg(a order by a.opened_at desc,a.id) from public.stock_alerts a where a.resolved_at is null),'[]'::jsonb)
 ) end
$$;
commit;
