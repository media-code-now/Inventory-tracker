-- Ported from supabase/migrations/004_transactions.sql. Neon uses server-side transactions, not PostgREST or replication.
begin;
alter table public.movements drop constraint movements_kind_check;
alter table public.movements add constraint movements_kind_check check(kind in ('add','remove','return','adjust','transfer','reversal'));
alter table public.movements add column reason text,add column notes text,add column recipient text,
  add column quantity integer,add column requested_quantity integer,add column request_id uuid,
  add column request_payload jsonb,add column reverses_id uuid references public.movements(id);
update public.movements set reason=note,quantity=coalesce(transfer_quantity,abs(delta));
alter table public.movements alter column reason set not null,alter column quantity set not null;
alter table public.movements add constraint movement_reason_valid check(length(trim(reason))>0),
  add constraint movement_quantity_valid check(quantity>=0),
  add constraint movement_idempotency_valid check((request_id is null)=(request_payload is null)),
  add constraint reversal_link_valid check((kind='reversal')=(reverses_id is not null));
create unique index movement_request_unique on public.movements(actor_id,request_id) where request_id is not null;
create unique index one_reversal_per_movement on public.movements(reverses_id) where reverses_id is not null;
-- No mutable status on a posted row: corrections append their own records.
create function public.immutable_movement() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Posted movements are immutable; post a linked reversal instead'; end $$;
revoke all on function public.immutable_movement() from public,anon,authenticated;
create trigger movement_immutable before update or delete on public.movements for each row execute function public.immutable_movement();
-- Retire clients that bypass mandatory idempotency keys.
revoke execute on function public.record_stock(uuid,text,integer,text,uuid),public.transfer_stock(uuid,uuid,uuid,integer,text) from authenticated;

create function public.post_movement(p_request uuid,p_item uuid,p_kind text,p_amount integer,p_from uuid,p_to uuid,
  p_reason text,p_notes text default null,p_recipient text default null,p_reverses uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); payload jsonb; existing public.movements%rowtype; original public.movements%rowtype;
  total_qty integer; item_status text; from_id uuid:=p_from; to_id uuid:=p_to;
  source_qty integer; target_qty integer; source_next integer; target_next integer;
  stock_delta integer:=0; amount integer:=p_amount; posted_id uuid:=gen_random_uuid();
  transfer_amount integer; requested integer:=p_amount;
begin
  if p_kind in ('adjust','reversal') then perform public.require_office_role(array['admin']);
  else perform public.require_office_role(array['admin','staff']); end if;
  if p_request is null then raise exception 'A request ID is required';end if;
  if p_reason is null or length(trim(p_reason))=0 or length(p_reason)>500 or length(coalesce(p_notes,''))>4000 or length(coalesce(p_recipient,''))>200 then raise exception 'Enter a reason and valid notes/recipient';end if;
  if p_kind is null or p_kind not in ('add','remove','return','adjust','transfer','reversal') then raise exception 'Invalid movement type';end if;
  payload:=jsonb_build_object('item',p_item,'kind',p_kind,'amount',p_amount,'from',p_from,'to',p_to,'reason',trim(p_reason),'notes',nullif(trim(p_notes),''),'recipient',nullif(trim(p_recipient),''),'reverses',p_reverses);
  -- Same user/key serializes before reading the ledger, even for requests on different items.
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request::text,0));
  select * into existing from public.movements where actor_id=actor and request_id=p_request;
  if found then
    if existing.request_payload<>payload then raise exception 'Request ID already used for different transaction details';end if;
    return existing.id;
  end if;
  select quantity,status into total_qty,item_status from public.items where id=p_item for update;
  if not found then raise exception 'Item not found';end if;
  if item_status<>'active' then raise exception 'Restore the archived item before posting transactions';end if;
  if p_kind='reversal' then
    if p_amount is not null or p_from is not null or p_to is not null or p_recipient is not null then raise exception 'Reversal details are derived from the original movement';end if;
    select * into original from public.movements where id=p_reverses and item_id=p_item;
    if not found or original.kind='reversal' then raise exception 'Choose an original movement to reverse';end if;
    if exists(select 1 from public.movements where reverses_id=original.id) then raise exception 'This movement has already been reversed';end if;
    requested:=null;amount:=original.quantity;
    if original.kind='transfer' then
      from_id:=original.to_location_id;to_id:=original.from_location_id;transfer_amount:=original.transfer_quantity;
    else
      stock_delta:=-original.delta;
      if stock_delta<0 then from_id:=coalesce(original.to_location_id,original.from_location_id);to_id:=null;
      else to_id:=coalesce(original.from_location_id,original.to_location_id);from_id:=null;end if;
    end if;
    if from_id is null and to_id is null then raise exception 'Original location is missing; use a documented admin adjustment';end if;
  else
    if p_reverses is not null then raise exception 'Only reversals may link an original movement';end if;
    if amount is null or amount<0 or (p_kind<>'adjust' and amount=0) then raise exception 'Enter a valid quantity';end if;
    if p_kind<>'remove' and nullif(trim(p_recipient),'') is not null then raise exception 'Recipient is only valid for issued stock';end if;
    if p_kind in ('add','return','adjust') then
      if to_id is null or from_id is not null then raise exception 'Choose a destination location';end if;
    elsif p_kind='remove' then
      if from_id is null or to_id is not null then raise exception 'Choose a source location';end if;
    else
      if from_id is null or to_id is null or from_id=to_id then raise exception 'Choose different source and destination locations';end if;
      transfer_amount:=amount;
    end if;
  end if;
  if transfer_amount is not null then
    select quantity into source_qty from public.stock_balances where item_id=p_item and location_id=from_id;
    if source_qty is null or source_qty<transfer_amount then raise exception 'Not enough stock at source location';end if;
    insert into public.stock_balances(item_id,location_id,quantity) values(p_item,to_id,0) on conflict do nothing;
    select quantity into target_qty from public.stock_balances where item_id=p_item and location_id=to_id;
    source_next:=source_qty-transfer_amount;target_next:=target_qty+transfer_amount;
    update public.stock_balances set quantity=source_next where item_id=p_item and location_id=from_id;
    update public.stock_balances set quantity=target_next where item_id=p_item and location_id=to_id;
    stock_delta:=0;
  elsif from_id is not null then
    select quantity into source_qty from public.stock_balances where item_id=p_item and location_id=from_id;
    if p_kind='remove' then stock_delta:=-amount;end if;
    if source_qty is null or source_qty+stock_delta<0 then raise exception 'Not enough stock at source location';end if;
    source_next:=source_qty+stock_delta;
    update public.stock_balances set quantity=source_next where item_id=p_item and location_id=from_id;
  else
    insert into public.stock_balances(item_id,location_id,quantity) values(p_item,to_id,0) on conflict do nothing;
    select quantity into target_qty from public.stock_balances where item_id=p_item and location_id=to_id;
    if p_kind='adjust' then stock_delta:=amount-target_qty;amount:=abs(stock_delta);
    elsif p_kind in ('add','return') then stock_delta:=amount;end if;
    target_next:=target_qty+stock_delta;
    if target_next<0 then raise exception 'Not enough stock at destination location';end if;
    update public.stock_balances set quantity=target_next where item_id=p_item and location_id=to_id;
  end if;
  update public.items set quantity=total_qty+stock_delta where id=p_item;
  insert into public.movements(id,item_id,actor_id,kind,delta,before_quantity,after_quantity,note,reason,notes,recipient,
    quantity,requested_quantity,from_location_id,to_location_id,transfer_quantity,source_before,source_after,target_before,target_after,request_id,request_payload,reverses_id)
  values(posted_id,p_item,actor,p_kind,stock_delta,total_qty,total_qty+stock_delta,trim(p_reason),trim(p_reason),nullif(trim(p_notes),''),nullif(trim(p_recipient),''),
    amount,requested,from_id,to_id,transfer_amount,source_qty,source_next,target_qty,target_next,p_request,payload,p_reverses);
  return posted_id;
end $$;
revoke all on function public.post_movement(uuid,uuid,text,integer,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.post_movement(uuid,uuid,text,integer,uuid,uuid,text,text,text,uuid) to authenticated;
commit;
