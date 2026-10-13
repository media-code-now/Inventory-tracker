-- Ported from supabase/migrations/002_invitation_access.sql. Neon uses server-side transactions, not PostgREST or replication.
begin;

-- Read authorization always uses current database membership, never JWT metadata.
create or replace function public.office_role() returns text language sql stable
security definer set search_path = '' as $$
  select role from public.members where id=auth.uid() and active
$$;

-- Mutation authorization locks membership so deactivation and writes serialize.
create function public.require_office_role(allowed_roles text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare member_role text;
begin
  select role into member_role from public.members where id=auth.uid() and active for share;
  if member_role is null or not (member_role=any(allowed_roles)) then
    raise exception 'Access denied' using errcode='42501';
  end if;
end $$;
revoke all on function public.require_office_role(text[]) from public,anon,authenticated;

-- Deactivated users cannot read membership records or inventory. The client polls office_role.
drop policy member_read on public.members;
create policy member_read on public.members for select to authenticated
using (public.office_role() is not null);

-- Existing members may only be updated; invitations are the sole enrollment path.
create or replace function public.set_member(p_id uuid,p_name text,p_role text,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  lock table public.members in share row exclusive mode;
  perform public.require_office_role(array['admin']);
  if p_id is null or p_id=auth.uid() then raise exception 'You cannot change your own membership'; end if;
  if p_role is null or p_role not in ('admin','staff','viewer') or p_active is null
    or p_name is null or length(trim(p_name))=0 then raise exception 'Invalid membership'; end if;
  update public.members set name=trim(p_name),role=p_role,active=p_active where id=p_id;
  if not found then raise exception 'Invite new users first'; end if;
end $$;

create or replace function public.create_item(p_name text,p_sku text,p_category text,p_unit text,
p_minimum integer,p_cost numeric,p_location uuid,p_description text) returns uuid
language plpgsql security definer set search_path='' as $$
declare item_id uuid;
begin
  perform public.require_office_role(array['admin']);
  if p_sku is null or length(trim(p_sku))=0 then raise exception 'SKU required'; end if;
  insert into public.items(name,sku,category,unit,minimum,cost,location_id,description)
  values(trim(p_name),trim(p_sku),p_category,p_unit,p_minimum,p_cost,p_location,p_description)
  returning id into item_id;
  return item_id;
end $$;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check(email=lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  name text not null check(length(trim(name))>0),
  role text not null check(role in ('admin','staff','viewer')),
  invited_by uuid not null references public.members(id),
  user_id uuid references auth.users(id),
  status text not null default 'sending' check(status in ('sending','pending','accepted','revoked','failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  accepted_at timestamptz,
  check (status not in ('pending','accepted') or user_id is not null)
);
create unique index one_open_invite_per_email on public.invitations(email) where status in ('sending','pending');
alter table public.invitations enable row level security;
create policy admin_invitation_read on public.invitations for select to authenticated using(public.office_role()='admin');
revoke all on public.invitations from public,anon,authenticated;
grant select on public.invitations to authenticated;
-- Service credentials exist only inside the Supabase Edge Function.
grant select,update on public.invitations to service_role;

create function public.prepare_invitation(p_email text,p_name text,p_role text) returns uuid
language plpgsql security definer set search_path='' as $$
declare invitation_id uuid; email_normalized text := lower(trim(p_email));
begin
  perform public.require_office_role(array['admin']);
  -- Serialize per inviter for the rate limit, independently of concurrent HTTP requests.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if p_email is null or p_name is null or p_role is null then raise exception 'Invalid invitation'; end if;
  if exists(select 1 from auth.users u join public.members m on m.id=u.id where lower(u.email)=email_normalized) then
    raise exception 'This account already has membership; manage its existing access';
  end if;
  if (select count(*) from public.invitations where invited_by=auth.uid() and created_at>now()-interval '1 hour')>=20 then
    raise exception 'Invitation limit reached; try again later';
  end if;
  update public.invitations set status='revoked' where email=email_normalized
    and status in ('sending','pending') and expires_at<=now();
  insert into public.invitations(email,name,role,invited_by) values(email_normalized,trim(p_name),p_role,auth.uid())
    returning id into invitation_id;
  return invitation_id;
end $$;

-- The browser cannot bind a forged user ID to an invitation.
create function public.finish_invitation(p_invitation uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.invitations i set status='pending',user_id=p_user
  where i.id=p_invitation and i.status='sending' and i.expires_at>now()
    and exists(select 1 from auth.users u where u.id=p_user and lower(u.email)=i.email and u.invited_at is not null);
  if not found then raise exception 'Unable to finalize invitation'; end if;
end $$;

create function public.accept_invitation() returns text
language plpgsql security definer set search_path='' as $$
declare invitation public.invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- Match the lock order used by admin role/deactivation updates.
  lock table public.members in share row exclusive mode;
  -- No name, UUID, role or email is accepted from the browser.
  select i.* into invitation from public.invitations i join auth.users u on u.id=i.user_id
  where i.user_id=auth.uid() and lower(u.email)=i.email and u.email_confirmed_at is not null
    and i.status='pending' and i.expires_at>now() order by i.created_at desc limit 1 for update of i;
  if not found then raise exception 'No valid invitation for this account'; end if;
  perform 1 from public.members where id=invitation.invited_by and active and role='admin' for share;
  if not found then raise exception 'Invitation issuer no longer has admin access'; end if;
  -- Never re-enable or change an existing membership through an old invite.
  insert into public.members(id,name,role,active) values(auth.uid(),invitation.name,invitation.role,true);
  update public.invitations set status='accepted',accepted_at=now() where id=invitation.id;
  return invitation.role;
end $$;

create function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_office_role(array['admin']);
  update public.invitations set status='revoked' where id=p_invitation and status in ('sending','pending');
  if not found then raise exception 'No pending invitation'; end if;
end $$;

revoke all on function public.prepare_invitation(text,text,text),public.finish_invitation(uuid,uuid),
  public.accept_invitation(),public.revoke_invitation(uuid) from public,anon,authenticated;
grant execute on function public.prepare_invitation(text,text,text),public.accept_invitation(),
  public.revoke_invitation(uuid) to authenticated;
grant execute on function public.finish_invitation(uuid,uuid) to service_role;

-- Per-location balances are needed for receive, issue, and transfer operations.
-- Preserve legacy positive stock without a location in a distinct migration location.
insert into public.locations(name,description)
select 'Unassigned (migration)','Legacy stock awaiting a storage assignment'
where exists(select 1 from public.items where location_id is null and quantity>0)
on conflict(name) do nothing;
update public.items set location_id=(select id from public.locations where name='Unassigned (migration)')
where location_id is null and quantity>0;
create table public.stock_balances (
  item_id uuid not null references public.items(id),
  location_id uuid not null references public.locations(id),
  quantity integer not null default 0 check(quantity>=0),
  primary key(item_id,location_id)
);
insert into public.stock_balances(item_id,location_id,quantity)
select id,location_id,quantity from public.items where location_id is not null;
alter table public.stock_balances enable row level security;
create policy balance_read on public.stock_balances for select to authenticated using(public.office_role() is not null);
revoke all on public.stock_balances from public,anon,authenticated;
grant select on public.stock_balances to authenticated;

alter table public.movements drop constraint movements_kind_check;
alter table public.movements add constraint movements_kind_check check(kind in ('add','remove','adjust','transfer'));
alter table public.movements add column from_location_id uuid references public.locations(id),
  add column to_location_id uuid references public.locations(id),
  add column transfer_quantity integer,
  add column source_before integer, add column source_after integer,
  add column target_before integer, add column target_after integer;
alter table public.movements add constraint valid_transfer check(kind<>'transfer' or (
  transfer_quantity is not null and transfer_quantity>0 and from_location_id is not null
  and to_location_id is not null and from_location_id<>to_location_id and delta=0
  and before_quantity=after_quantity and source_before is not null and source_after>=0
  and target_before is not null and target_after>=0
  and source_before-source_after=transfer_quantity and target_after-target_before=transfer_quantity));

-- Remove the permissive legacy signature, including its staff adjustment behavior.
drop function public.record_stock(uuid,text,integer,text);
create function public.record_stock(p_item uuid,p_kind text,p_amount integer,p_note text,p_location uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare old_total integer; old_balance integer; new_balance integer; selected_location uuid;
begin
  if p_kind='adjust' then perform public.require_office_role(array['admin']);
  else perform public.require_office_role(array['admin','staff']); end if;
  if p_kind is null or p_kind not in ('add','remove','adjust') or p_amount is null or p_amount<0
    or (p_kind<>'adjust' and p_amount=0) then raise exception 'Invalid stock change'; end if;
  if p_note is null or length(trim(p_note))=0 then raise exception 'A reason is required'; end if;
  select quantity,coalesce(p_location,location_id) into old_total,selected_location from public.items where id=p_item for update;
  if not found then raise exception 'Item not found'; end if;
  if selected_location is null then raise exception 'Choose a storage location'; end if;
  insert into public.stock_balances(item_id,location_id,quantity) values(p_item,selected_location,0) on conflict do nothing;
  select quantity into old_balance from public.stock_balances where item_id=p_item and location_id=selected_location;
  new_balance := case p_kind when 'add' then old_balance+p_amount when 'remove' then old_balance-p_amount else p_amount end;
  if new_balance<0 then raise exception 'Not enough stock at this location'; end if;
  update public.stock_balances set quantity=new_balance where item_id=p_item and location_id=selected_location;
  update public.items set quantity=old_total+new_balance-old_balance where id=p_item;
  insert into public.movements(item_id,actor_id,kind,delta,before_quantity,after_quantity,note,
    from_location_id,to_location_id,source_before,source_after,target_before,target_after)
  values(p_item,auth.uid(),p_kind,new_balance-old_balance,old_total,old_total+new_balance-old_balance,trim(p_note),
    case when p_kind='remove' then selected_location end,case when p_kind<>'remove' then selected_location end,
    case when p_kind='remove' then old_balance end,case when p_kind='remove' then new_balance end,
    case when p_kind<>'remove' then old_balance end,case when p_kind<>'remove' then new_balance end);
end $$;

create function public.transfer_stock(p_item uuid,p_from uuid,p_to uuid,p_amount integer,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare current_total integer; source_qty integer; target_qty integer;
begin
  perform public.require_office_role(array['admin','staff']);
  if p_from is null or p_to is null or p_from=p_to or p_amount is null or p_amount<=0
    or p_note is null or length(trim(p_note))=0 then raise exception 'Invalid transfer'; end if;
  select quantity into current_total from public.items where id=p_item for update;
  if not found then raise exception 'Item not found'; end if;
  select quantity into source_qty from public.stock_balances where item_id=p_item and location_id=p_from;
  if source_qty is null or source_qty<p_amount then raise exception 'Not enough stock at source location'; end if;
  insert into public.stock_balances(item_id,location_id,quantity) values(p_item,p_to,0) on conflict do nothing;
  select quantity into target_qty from public.stock_balances where item_id=p_item and location_id=p_to;
  update public.stock_balances set quantity=quantity-p_amount where item_id=p_item and location_id=p_from;
  update public.stock_balances set quantity=quantity+p_amount where item_id=p_item and location_id=p_to;
  insert into public.movements(item_id,actor_id,kind,delta,before_quantity,after_quantity,note,
    from_location_id,to_location_id,transfer_quantity,source_before,source_after,target_before,target_after)
  values(p_item,auth.uid(),'transfer',0,current_total,current_total,trim(p_note),p_from,p_to,p_amount,
    source_qty,source_qty-p_amount,target_qty,target_qty+p_amount);
end $$;
revoke all on function public.record_stock(uuid,text,integer,text,uuid),public.transfer_stock(uuid,uuid,uuid,integer,text)
from public,anon,authenticated;
grant execute on function public.record_stock(uuid,text,integer,text,uuid),public.transfer_stock(uuid,uuid,uuid,integer,text)
to authenticated;
commit;
