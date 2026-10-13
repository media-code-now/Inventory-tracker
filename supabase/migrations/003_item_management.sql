begin;

alter table public.items
  add column barcode text,
  add column supplier text,
  add column image_path text,
  add column status text not null default 'active' check(status in ('active','archived')),
  add column updated_at timestamptz not null default now(),
  add column archived_at timestamptz;
-- Identifiers stay reserved after archive. Multiple NULL barcodes are allowed.
alter table public.items add constraint item_sku_valid check(sku=trim(sku) and length(sku)>0),
  add constraint item_barcode_valid check(barcode is null or (barcode=trim(barcode) and length(barcode)>0)),
  add constraint item_category_valid check(length(trim(category))>0),
  add constraint item_unit_valid check(length(trim(unit))>0),
  add constraint item_supplier_valid check(supplier is null or length(trim(supplier))>0),
  add constraint item_cost_finite check(cost<>'NaN'::numeric and cost>=0),
  add constraint item_archive_valid check((status='active' and archived_at is null) or (status='archived' and archived_at is not null)),
  add constraint item_image_path_valid check(image_path is null or image_path ~ ('^items/'||id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$'));
create unique index item_sku_case_insensitive on public.items(lower(sku));
create unique index item_barcode_unique on public.items(barcode) where barcode is not null;
create index item_category_status on public.items(category,status);
create index balance_location_item on public.stock_balances(location_id,item_id);

create function public.touch_item_updated_at() returns trigger language plpgsql set search_path='' as $$
begin
  new.created_at := old.created_at;
  new.updated_at := clock_timestamp();
  return new;
end $$;
revoke all on function public.touch_item_updated_at() from public,anon,authenticated;
create trigger item_updated_at before update on public.items for each row execute function public.touch_item_updated_at();

-- Private, immutable object names; no browser can overwrite existing image data.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('item-images','item-images',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy item_image_read on storage.objects for select to authenticated using(
  bucket_id='item-images' and public.office_role() is not null and
  (public.office_role()='admin' or exists(select 1 from public.items i where i.image_path=storage.objects.name))
);
create policy item_image_upload on storage.objects for insert to authenticated with check(
  bucket_id='item-images' and public.office_role()='admin' and name ~ '^items/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
);
create policy item_image_orphan_cleanup on storage.objects for delete to authenticated using(
  bucket_id='item-images' and public.office_role()='admin' and not exists(select 1 from public.items i where i.image_path=storage.objects.name)
);

create function public.validate_item_image(p_item uuid,p_path text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_path is not null and (p_path !~ ('^items/'||p_item::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') or
    not exists(select 1 from storage.objects where bucket_id='item-images' and name=p_path)) then
    raise exception 'Upload a valid image for this item first';
  end if;
end $$;
revoke all on function public.validate_item_image(uuid,text) from public,anon,authenticated;

-- Replace the old function with optional metadata arguments; older callers still create zero stock.
drop function public.create_item(text,text,text,text,integer,numeric,uuid,text);
create function public.create_item(p_name text,p_sku text,p_category text,p_unit text,
  p_minimum integer,p_cost numeric,p_location uuid,p_description text,
  p_barcode text default null,p_supplier text default null,p_image_path text default null,p_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform public.require_office_role(array['admin']);
  if p_id is null then raise exception 'Item ID required'; end if;
  perform public.validate_item_image(p_id,p_image_path);
  insert into public.items(id,name,sku,category,unit,minimum,cost,location_id,description,barcode,supplier,image_path)
  values(p_id,trim(p_name),trim(p_sku),trim(p_category),trim(p_unit),p_minimum,p_cost,p_location,
    coalesce(p_description,''),nullif(trim(p_barcode),''),nullif(trim(p_supplier),''),p_image_path);
  return p_id;
end $$;

-- No quantity, balance, lifecycle, or timestamp parameters are accepted by metadata editing.
create function public.update_item(p_item uuid,p_name text,p_sku text,p_barcode text,p_category text,
  p_description text,p_unit text,p_cost numeric,p_supplier text,p_minimum integer,p_location uuid,
  p_image_path text,p_expected_updated_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare item_record public.items%rowtype;
begin
  perform public.require_office_role(array['admin']);
  select * into item_record from public.items where id=p_item for update;
  if not found then raise exception 'Item not found'; end if;
  if p_expected_updated_at is null or item_record.updated_at<>p_expected_updated_at then
    raise exception 'This item changed. Reopen it before saving your edits.' using errcode='40001';
  end if;
  perform public.validate_item_image(p_item,p_image_path);
  update public.items set name=trim(p_name),sku=trim(p_sku),barcode=nullif(trim(p_barcode),''),
    category=trim(p_category),description=coalesce(p_description,''),unit=trim(p_unit),cost=p_cost,
    supplier=nullif(trim(p_supplier),''),minimum=p_minimum,location_id=p_location,image_path=p_image_path
  where id=p_item;
end $$;

create function public.set_item_archived(p_item uuid,p_archived boolean,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare item_record public.items%rowtype;
begin
  perform public.require_office_role(array['admin']);
  select * into item_record from public.items where id=p_item for update;
  if not found then raise exception 'Item not found'; end if;
  if p_archived is null then raise exception 'Archive status required'; end if;
  if p_expected_updated_at is null or item_record.updated_at<>p_expected_updated_at then
    raise exception 'This item changed. Reopen it before archiving or restoring it.' using errcode='40001';
  end if;
  update public.items set status=case when p_archived then 'archived' else 'active' end,
    archived_at=case when p_archived then coalesce(archived_at,now()) else null end where id=p_item;
end $$;
revoke all on function public.create_item(text,text,text,text,integer,numeric,uuid,text,text,text,text,uuid),
  public.update_item(uuid,text,text,text,text,text,text,numeric,text,integer,uuid,text,timestamptz),
  public.set_item_archived(uuid,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.create_item(text,text,text,text,integer,numeric,uuid,text,text,text,text,uuid),
  public.update_item(uuid,text,text,text,text,text,text,numeric,text,integer,uuid,text,timestamptz),
  public.set_item_archived(uuid,boolean,timestamptz) to authenticated;

-- The item row is locked by stock RPCs before any balance changes, so archive and stock operations serialize.
create function public.reject_archived_stock() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.items where id=new.item_id and status='archived') then
    raise exception 'Archived items cannot receive stock movements. Restore the item first.';
  end if;
  return new;
end $$;
revoke all on function public.reject_archived_stock() from public,anon,authenticated;
create trigger archived_balance_guard before insert or update on public.stock_balances
for each row execute function public.reject_archived_stock();
create trigger archived_movement_guard before insert on public.movements
for each row execute function public.reject_archived_stock();
commit;
