begin;
create table public.members (id uuid primary key references auth.users(id), name text not null, role text not null check(role in ('admin','staff','viewer')), active boolean not null default true);
create function public.office_role() returns text language sql stable security definer set search_path = public as $$ select role from members where id=auth.uid() and active $$;
revoke all on function public.office_role() from public; grant execute on function public.office_role() to authenticated;
create table public.locations (id uuid primary key default gen_random_uuid(), name text not null unique, description text not null default '');
create table public.items (id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) > 0), sku text not null unique, category text not null, unit text not null default 'units', quantity integer not null default 0 check(quantity>=0), minimum integer not null default 5 check(minimum>=0), cost numeric(12,2) not null default 0 check(cost>=0), location_id uuid references locations(id), description text not null default '', created_at timestamptz not null default now());
create table public.movements (id uuid primary key default gen_random_uuid(), item_id uuid not null references items(id), actor_id uuid not null references members(id), kind text not null check(kind in ('add','remove','adjust')), delta integer not null, before_quantity integer not null, after_quantity integer not null check(after_quantity>=0), note text not null check(length(trim(note))>0), created_at timestamptz not null default now());
alter table members enable row level security; alter table locations enable row level security; alter table items enable row level security; alter table movements enable row level security;
create policy member_read on members for select to authenticated using(public.office_role() is not null);
create policy location_read on locations for select to authenticated using(public.office_role() is not null);
create policy location_create on locations for insert to authenticated with check(public.office_role()='admin');
create policy item_read on items for select to authenticated using(public.office_role() is not null);
create policy movement_read on movements for select to authenticated using(public.office_role() is not null);
revoke all on members,locations,items,movements from anon,authenticated;
grant select on members,locations,items,movements to authenticated; grant insert on locations to authenticated;
create function public.record_stock(p_item uuid,p_kind text,p_amount integer,p_note text) returns void language plpgsql security definer set search_path=public as $$
declare old_qty integer; new_qty integer;
begin
 if coalesce(office_role(),'') not in ('admin','staff') then raise exception 'Stock changes require a staff account'; end if;
 if p_kind not in ('add','remove','adjust') or p_kind is null or p_amount is null or p_amount<0 or (p_kind<>'adjust' and p_amount=0) then raise exception 'Invalid stock change'; end if;
 if p_note is null or length(trim(p_note))=0 then raise exception 'A reason is required'; end if;
 select quantity into old_qty from items where id=p_item for update;
 if not found then raise exception 'Item not found'; end if;
 new_qty := case p_kind when 'add' then old_qty+p_amount when 'remove' then old_qty-p_amount else p_amount end;
 if new_qty<0 then raise exception 'Not enough stock available'; end if;
 update items set quantity=new_qty where id=p_item;
 insert into movements(item_id,actor_id,kind,delta,before_quantity,after_quantity,note) values(p_item,auth.uid(),p_kind,new_qty-old_qty,old_qty,new_qty,trim(p_note));
end $$;
create function public.create_item(p_name text,p_sku text,p_category text,p_unit text,p_minimum integer,p_cost numeric,p_location uuid,p_description text) returns uuid language plpgsql security definer set search_path=public as $$
declare item_id uuid;
begin
 if coalesce(office_role(),'') not in ('admin','staff') then raise exception 'Staff access required'; end if;
 insert into items(name,sku,category,unit,minimum,cost,location_id,description) values(trim(p_name),trim(p_sku),p_category,p_unit,p_minimum,p_cost,p_location,p_description) returning id into item_id;
 return item_id;
end $$;
create function public.set_member(p_id uuid,p_name text,p_role text,p_active boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if office_role()<>'admin' or office_role() is null then raise exception 'Admin access required'; end if;
 if p_id=auth.uid() then raise exception 'You cannot change your own membership'; end if;
 insert into members(id,name,role,active) values(p_id,trim(p_name),p_role,p_active) on conflict(id) do update set name=excluded.name,role=excluded.role,active=excluded.active;
end $$;
revoke all on function public.record_stock(uuid,text,integer,text), public.create_item(text,text,text,text,integer,numeric,uuid,text),public.set_member(uuid,text,text,boolean) from public;
grant execute on function public.record_stock(uuid,text,integer,text), public.create_item(text,text,text,text,integer,numeric,uuid,text),public.set_member(uuid,text,text,boolean) to authenticated;
alter publication supabase_realtime add table public.items,public.movements,public.locations,public.members;
commit;
