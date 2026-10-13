-- Ported from supabase/migrations/007_physical_counts.sql. Neon uses server-side transactions, not PostgREST or replication.
begin;
alter table public.items add column stock_revision bigint not null default 0 check(stock_revision>=0);
create function public.bump_stock_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.items set stock_revision=stock_revision+1 where id=new.item_id;return new;end $$;
revoke all on function public.bump_stock_revision() from public,anon,authenticated;
create trigger movement_stock_revision before insert on public.movements for each row execute function public.bump_stock_revision();
create table public.stock_counts(
 id uuid primary key default gen_random_uuid(),location_id uuid not null references public.locations(id),
 title text not null check(length(trim(title))>0),state text not null default 'draft' check(state in ('draft','in_progress','awaiting_approval','completed')),
 created_by uuid not null references public.members(id),created_at timestamptz not null default now(),started_at timestamptz,
 submitted_at timestamptz,completed_at timestamptz,approved_by uuid references public.members(id),approval_reason text
);
create unique index one_open_count_per_location on public.stock_counts(location_id) where state<>'completed';
create table public.stock_count_lines(
 id uuid primary key default gen_random_uuid(),count_id uuid not null references public.stock_counts(id),item_id uuid not null references public.items(id),
 item_name text not null,sku text not null,unit text not null,expected_quantity integer not null check(expected_quantity>=0),
 initial_revision bigint not null,initial_snapshot_at timestamptz not null default clock_timestamp(),
 baseline_quantity integer not null check(baseline_quantity>=0),baseline_revision bigint not null,baseline_unit text not null,
 baseline_at timestamptz not null default clock_timestamp(),counted_quantity integer check(counted_quantity>=0),
 counted_by uuid references public.members(id),counted_at timestamptz,notes text,
 entry_version integer not null default 0,approval_request_id uuid not null default gen_random_uuid() unique,
 adjustment_id uuid unique references public.movements(id),unique(count_id,item_id)
);
create table public.stock_count_entries(
 id uuid primary key default gen_random_uuid(),line_id uuid not null references public.stock_count_lines(id),
 action text not null check(action in ('count','recount_snapshot')),actor_id uuid not null references public.members(id),created_at timestamptz not null default clock_timestamp(),
 baseline_quantity integer not null,baseline_revision bigint not null,unit text not null,counted_quantity integer check(counted_quantity>=0),notes text
);
alter table public.stock_counts enable row level security;alter table public.stock_count_lines enable row level security;alter table public.stock_count_entries enable row level security;
create policy count_read on public.stock_counts for select to authenticated using(public.office_role() is not null);
create policy line_read on public.stock_count_lines for select to authenticated using(public.office_role() is not null);
create policy entry_read on public.stock_count_entries for select to authenticated using(public.office_role() is not null);
revoke all on public.stock_counts,public.stock_count_lines,public.stock_count_entries from public,anon,authenticated;
grant select on public.stock_counts,public.stock_count_lines,public.stock_count_entries to authenticated;

create function public.create_stock_count(p_id uuid,p_location uuid,p_title text) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.stock_counts%rowtype;
begin
 perform public.require_office_role(array['admin']);
 if p_id is null then raise exception 'Request ID required';end if;
 if p_location is null or p_title is null or length(trim(p_title))=0 then raise exception 'Location and title required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
 select * into existing from public.stock_counts where id=p_id;
 if found then if existing.created_by<>auth.uid() or existing.location_id<>p_location or existing.title<>trim(p_title) then raise exception 'Count ID already used';end if;return existing.id;end if;
 insert into public.stock_counts(id,location_id,title,created_by) values(p_id,p_location,trim(p_title),auth.uid());return p_id;
end $$;

create function public.start_stock_count(p_count uuid) returns void language plpgsql security definer set search_path='' as $$
declare header public.stock_counts%rowtype;
begin
 perform public.require_office_role(array['admin']);
 -- A brief exclusive writer lock avoids item/location-scope phantoms and locks before item rows.
 -- Normal SELECT snapshots remain available. Stock writes resume once the snapshot is committed.
 lock table public.items in exclusive mode;
 select * into header from public.stock_counts where id=p_count for update;
 if not found then raise exception 'Count not found';end if;
 if header.state<>'draft' then raise exception 'Only draft counts can start';end if;
 insert into public.stock_count_lines(count_id,item_id,item_name,sku,unit,expected_quantity,initial_revision,baseline_quantity,baseline_revision,baseline_unit)
 select header.id,i.id,i.name,i.sku,i.unit,coalesce(b.quantity,0),i.stock_revision,coalesce(b.quantity,0),i.stock_revision,i.unit
 from public.items i left join public.stock_balances b on b.item_id=i.id and b.location_id=header.location_id
 where i.status='active' and (i.location_id=header.location_id or b.item_id is not null);
 if not found then raise exception 'No active items assigned to this location';end if;
 update public.stock_counts set state='in_progress',started_at=clock_timestamp() where id=header.id;
end $$;

create function public.save_counted_quantity(p_line uuid,p_quantity integer,p_entry_version integer,p_notes text default null) returns void language plpgsql security definer set search_path='' as $$
declare line public.stock_count_lines%rowtype;header public.stock_counts%rowtype;
begin
 perform public.require_office_role(array['admin','staff']);
 select c.* into header from public.stock_counts c join public.stock_count_lines l on l.count_id=c.id where l.id=p_line for update of c;
 if not found or header.state<>'in_progress' then raise exception 'Count entry requires an in-progress count';end if;
 select * into line from public.stock_count_lines where id=p_line for update;
 if line.entry_version<>p_entry_version or p_entry_version is null then raise exception 'This line changed. Reload before entering a quantity.' using errcode='40001';end if;
 if p_quantity is null or p_quantity<0 then raise exception 'Enter a nonnegative counted quantity';end if;
 update public.stock_count_lines set counted_quantity=p_quantity,counted_by=auth.uid(),counted_at=clock_timestamp(),notes=nullif(trim(p_notes),''),entry_version=entry_version+1 where id=line.id;
 insert into public.stock_count_entries(line_id,action,actor_id,baseline_quantity,baseline_revision,unit,counted_quantity,notes)
 values(line.id,'count',auth.uid(),line.baseline_quantity,line.baseline_revision,line.baseline_unit,p_quantity,nullif(trim(p_notes),''));
end $$;

create function public.refresh_count_snapshot(p_count uuid,p_item uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare header public.stock_counts%rowtype;item public.items%rowtype;line_id uuid;qty integer;
begin
 perform public.require_office_role(array['admin']);
 if p_reason is null or length(trim(p_reason))=0 then raise exception 'Recount reason required';end if;
 lock table public.items in exclusive mode;
 select * into header from public.stock_counts where id=p_count for update;
 if not found or header.state not in ('in_progress','awaiting_approval') then raise exception 'This count cannot be recounted';end if;
 select * into item from public.items where id=p_item;
 if not found or item.status<>'active' then raise exception 'Restore the item before recounting';end if;
 select quantity into qty from public.stock_balances where item_id=p_item and location_id=header.location_id;
 qty:=coalesce(qty,0);
 if item.location_id is distinct from header.location_id and not exists(select 1 from public.stock_balances where item_id=p_item and location_id=header.location_id) then raise exception 'Item is not assigned to this location';end if;
 insert into public.stock_count_lines(count_id,item_id,item_name,sku,unit,expected_quantity,initial_revision,baseline_quantity,baseline_revision,baseline_unit)
 values(header.id,item.id,item.name,item.sku,item.unit,qty,item.stock_revision,qty,item.stock_revision,item.unit)
 on conflict(count_id,item_id) do update set baseline_quantity=excluded.baseline_quantity,baseline_revision=excluded.baseline_revision,
 baseline_unit=excluded.baseline_unit,baseline_at=clock_timestamp(),counted_quantity=null,counted_by=null,counted_at=null,notes=null,
 entry_version=public.stock_count_lines.entry_version+1 returning id into line_id;
 insert into public.stock_count_entries(line_id,action,actor_id,baseline_quantity,baseline_revision,unit,notes)
 values(line_id,'recount_snapshot',auth.uid(),qty,item.stock_revision,item.unit,trim(p_reason));
 update public.stock_counts set state='in_progress',submitted_at=null where id=header.id;
end $$;

create function public.submit_stock_count(p_count uuid) returns void language plpgsql security definer set search_path='' as $$
declare header public.stock_counts%rowtype;
begin
 perform public.require_office_role(array['admin','staff']);
 select * into header from public.stock_counts where id=p_count for update;
 if not found or header.state<>'in_progress' then raise exception 'Only in-progress counts can be submitted';end if;
 if not exists(select 1 from public.stock_count_lines where count_id=p_count) or exists(select 1 from public.stock_count_lines where count_id=p_count and counted_quantity is null) then raise exception 'Enter all counted quantities before submitting';end if;
 update public.stock_counts set state='awaiting_approval',submitted_at=clock_timestamp() where id=p_count;
end $$;

create function public.approve_stock_count(p_count uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare header public.stock_counts%rowtype;line public.stock_count_lines%rowtype;posted uuid;
begin
 perform public.require_office_role(array['admin']);
 lock table public.items in exclusive mode;
 select * into header from public.stock_counts where id=p_count for update;
 if not found then raise exception 'Count not found';end if;
 if header.state='completed' then return header.id;end if;
 if header.state<>'awaiting_approval' then raise exception 'Count must await approval first';end if;
 if p_reason is null or length(trim(p_reason))=0 then raise exception 'Approval reason required';end if;
 if exists(select 1 from public.items i join public.stock_count_lines l on l.item_id=i.id where l.count_id=p_count and (l.counted_quantity is null or i.stock_revision<>l.baseline_revision or i.unit<>l.baseline_unit or i.status<>'active')) then
  raise exception 'Stock moved or an item changed after its snapshot. Recount affected items before approval';end if;
 if exists(select 1 from public.items i left join public.stock_balances b on b.item_id=i.id and b.location_id=header.location_id where i.status='active' and (i.location_id=header.location_id or b.item_id is not null) and not exists(select 1 from public.stock_count_lines l where l.count_id=p_count and l.item_id=i.id)) then
  raise exception 'New items appeared at this location. Add them for recount before approval';end if;
 for line in select * from public.stock_count_lines where count_id=p_count order by item_id loop
  posted:=public.post_movement(line.approval_request_id,line.item_id,'adjust',line.counted_quantity,null,header.location_id,
   'Physical stock count approval',format('Count %s; line %s; initial expected %s %s; baseline %s %s; counted %s. Approval: %s',p_count,line.id,line.expected_quantity,line.unit,line.baseline_quantity,line.baseline_unit,line.counted_quantity,trim(p_reason)));
  update public.stock_count_lines set adjustment_id=posted where id=line.id;
 end loop;
 update public.stock_counts set state='completed',completed_at=clock_timestamp(),approved_by=auth.uid(),approval_reason=trim(p_reason) where id=p_count;
 return p_count;
end $$;
revoke all on function public.create_stock_count(uuid,uuid,text),public.start_stock_count(uuid),public.save_counted_quantity(uuid,integer,integer,text),public.refresh_count_snapshot(uuid,uuid,text),public.submit_stock_count(uuid),public.approve_stock_count(uuid,text) from public,anon,authenticated;
grant execute on function public.create_stock_count(uuid,uuid,text),public.start_stock_count(uuid),public.save_counted_quantity(uuid,integer,integer,text),public.refresh_count_snapshot(uuid,uuid,text),public.submit_stock_count(uuid),public.approve_stock_count(uuid,text) to authenticated;
create function public.count_audit_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Count entry history is immutable';end $$;
create trigger count_entries_immutable before update or delete on public.stock_count_entries for each row execute function public.count_audit_immutable();
revoke all on function public.count_audit_immutable() from public,anon,authenticated;
-- Extend the coherent invoker snapshot; the underlying function retains its RLS checks.
alter function public.inventory_snapshot() rename to inventory_snapshot_before_counts;
create function public.inventory_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select public.inventory_snapshot_before_counts() || jsonb_build_object(
 'counts',coalesce((select jsonb_agg(c order by c.created_at desc,c.id) from public.stock_counts c),'[]'::jsonb),
 'count_lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('current_revision',i.stock_revision,'current_quantity',coalesce(b.quantity,0),'needs_recount',c.state<>'completed' and (i.stock_revision<>l.baseline_revision or i.unit<>l.baseline_unit or i.status<>'active')) order by l.item_name,l.id)
 from public.stock_count_lines l join public.stock_counts c on c.id=l.count_id join public.items i on i.id=l.item_id left join public.stock_balances b on b.item_id=i.id and b.location_id=c.location_id),'[]'::jsonb),
 'count_entries',coalesce((select jsonb_agg(e order by e.created_at desc,e.id) from public.stock_count_entries e),'[]'::jsonb))
$$;
revoke all on function public.inventory_snapshot() from public,anon,authenticated;grant execute on function public.inventory_snapshot() to authenticated;
commit;
