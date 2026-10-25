-- The events stream signals a refresh only when snapshot data changed, instead of on every tick.
begin;
create table public.inventory_revision(id boolean primary key default true check(id),revision bigint not null);
insert into public.inventory_revision values(true,0);
alter table public.inventory_revision enable row level security;
create policy office_gate_required on public.inventory_revision as restrictive for all to anon,authenticated
using(public.office_gate_valid()) with check(public.office_gate_valid());
revoke all on public.inventory_revision from public,anon,authenticated;

-- Deferred to commit: the counter row is the last lock a writer takes, so it cannot deadlock with row locks,
-- and a reader never sees a new revision before the data it describes is visible.
create function public.bump_inventory_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('inventory.revision_bumped',true),'')<>'on' then
  update public.inventory_revision set revision=revision+1;
  perform set_config('inventory.revision_bumped','on',true);
 end if;
 return null;
end $$;
revoke all on function public.bump_inventory_revision() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['items','item_costs','stock_balances','locations','members','movements','invitations','stock_alerts','stock_counts','stock_count_lines','stock_count_entries'] loop
  execute format('create constraint trigger inventory_revision after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.bump_inventory_revision()',t);
 end loop;
end $$;

-- Null when the office session is invalid, so one query both revalidates the stream and reads the revision.
create function public.office_inventory_revision(p_hash text,p_generation text) returns bigint
language sql stable security definer set search_path='' as $$
 select case when public.office_session_valid(p_hash,p_generation) then (select revision from public.inventory_revision) end
$$;
revoke all on function public.office_inventory_revision(text,text) from public,anon,authenticated;
grant execute on function public.office_inventory_revision(text,text) to service_role;
commit;
