-- Ported from supabase/migrations/008_csv_reports.sql. Neon uses server-side transactions, not PostgREST or replication.
begin;
-- Costs never appear in item table reads or its realtime payloads.
create table public.item_costs(item_id uuid primary key references public.items(id),cost numeric(12,2) not null check(cost>=0 and cost<>'NaN'::numeric));
insert into public.item_costs select id,cost from public.items;
alter table public.item_costs enable row level security;
create policy cost_admin_read on public.item_costs for select to authenticated using(public.office_role()='admin');
revoke all on public.item_costs from public,anon,authenticated;
grant select on public.item_costs to authenticated;
alter table public.items drop column cost;
create or replace function public.create_item(p_name text,p_sku text,p_category text,p_unit text,
  p_minimum integer,p_cost numeric,p_location uuid,p_description text,
  p_barcode text default null,p_supplier text default null,p_image_path text default null,p_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform public.require_office_role(array['admin']);
  if p_id is null then raise exception 'Item ID required'; end if;
  perform public.validate_item_image(p_id,p_image_path);
  insert into public.items(id,name,sku,category,unit,minimum,location_id,description,barcode,supplier,image_path)
  values(p_id,trim(p_name),trim(p_sku),trim(p_category),trim(p_unit),p_minimum,p_location,
    coalesce(p_description,''),nullif(trim(p_barcode),''),nullif(trim(p_supplier),''),p_image_path);
  insert into public.item_costs(item_id,cost) values(p_id,p_cost);
  return p_id;
end $$;

-- No quantity, balance, lifecycle, or timestamp parameters are accepted by metadata editing.
create or replace function public.update_item(p_item uuid,p_name text,p_sku text,p_barcode text,p_category text,
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
    category=trim(p_category),description=coalesce(p_description,''),unit=trim(p_unit),
    supplier=nullif(trim(p_supplier),''),minimum=p_minimum,location_id=p_location,image_path=p_image_path
  where id=p_item;
  update public.item_costs set cost=p_cost where item_id=p_item;
end $$;

create or replace function public.inventory_snapshot_before_counts() returns jsonb language sql stable security invoker set search_path='' as $$
 select case when public.office_role() is null then null else jsonb_build_object(
 'confirmed_at',statement_timestamp(),
 'items',coalesce((select jsonb_agg((to_jsonb(i)||jsonb_build_object('cost',c.cost)) order by i.name,i.id) from public.items i left join public.item_costs c on c.item_id=i.id),'[]'::jsonb),
 'balances',coalesce((select jsonb_agg(b order by b.item_id,b.location_id) from public.stock_balances b),'[]'::jsonb),
 'locations',coalesce((select jsonb_agg(l order by l.name,l.id) from public.locations l),'[]'::jsonb),
 'members',coalesce((select jsonb_agg(m order by m.name,m.id) from public.members m),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg(m order by m.created_at desc,m.id) from public.movements m),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(i order by i.created_at desc,i.id) from public.invitations i),'[]'::jsonb),
 'alerts',coalesce((select jsonb_agg(a order by a.opened_at desc,a.id) from public.stock_alerts a where a.resolved_at is null),'[]'::jsonb)
 ) end
$$;

create table public.inventory_imports(
 id uuid primary key,actor_id uuid not null references public.members(id),kind text not null check(kind in ('items','opening')),
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
alter table public.inventory_imports enable row level security;
create policy import_admin_read on public.inventory_imports for select to authenticated using(public.office_role()='admin');
revoke all on public.inventory_imports from public,anon,authenticated;
grant select on public.inventory_imports to authenticated;
create trigger import_immutable before update or delete on public.inventory_imports for each row execute function public.immutable_movement();

-- The same validator powers preview and the authoritative, locked commit.
create function public.validate_inventory_import(p_kind text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; n integer:=0; errors jsonb:='[]'; messages text[]; v_sku text; loc uuid; item public.items%rowtype;
begin
 perform public.require_office_role(array['admin']);
 if p_kind not in ('items','opening') or p_kind is null then raise exception 'Unknown import type'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Rows must be an array'; end if;
 if jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>1000 then raise exception 'Import 1–1000 rows at a time'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  n:=n+1; messages:=array[]::text[]; v_sku:=trim(coalesce(r->>'sku','')); loc:=null;
  if jsonb_typeof(r)<>'object' then messages:=array_append(messages,'Invalid row'); end if;
  if v_sku='' then messages:=array_append(messages,'SKU is required'); end if;
  if p_kind='items' then
   if exists(select 1 from public.items where lower(items.sku)=lower(v_sku)) then messages:=array_append(messages,'SKU already exists; existing items are never overwritten'); end if;
   if (select count(*) from jsonb_array_elements(p_rows) x where lower(trim(x->>'sku'))=lower(v_sku))>1 then messages:=array_append(messages,'Duplicate SKU in file'); end if;
   if nullif(trim(r->>'barcode'),'') is not null and (exists(select 1 from public.items where barcode=trim(r->>'barcode')) or (select count(*) from jsonb_array_elements(p_rows) x where trim(x->>'barcode')=trim(r->>'barcode'))>1) then messages:=array_append(messages,'Duplicate barcode'); end if;
   if trim(coalesce(r->>'name',''))='' or trim(coalesce(r->>'category',''))='' or trim(coalesce(r->>'unit',''))='' then messages:=array_append(messages,'Name, category, and unit are required'); end if;
   if coalesce(r->>'minimum','') !~ '^[0-9]{1,10}$' then messages:=array_append(messages,'Minimum must be a nonnegative integer');
   elsif (r->>'minimum')::numeric>2147483647 then messages:=array_append(messages,'Minimum exceeds supported range'); end if;
   if coalesce(r->>'unit_cost','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then messages:=array_append(messages,'Unit cost must be nonnegative, with at most two decimals'); end if;
  else
   select * into item from public.items where lower(items.sku)=lower(v_sku);
   if not found then messages:=array_append(messages,'SKU does not exist; import items first');
   elsif item.status<>'active' then messages:=array_append(messages,'Item is archived'); end if;
   if coalesce(r->>'quantity','') !~ '^[0-9]{1,10}$' then messages:=array_append(messages,'Quantity must be a positive integer');
   elsif (r->>'quantity')::numeric<1 or (r->>'quantity')::numeric>2147483647 then messages:=array_append(messages,'Quantity must be between 1 and 2147483647'); end if;
   if trim(coalesce(r->>'reason',''))='' then messages:=array_append(messages,'Reason is required'); end if;
   if (select count(*) from jsonb_array_elements(p_rows) x where lower(trim(x->>'sku'))=lower(v_sku) and lower(trim(x->>'location'))=lower(trim(r->>'location')))>1 then messages:=array_append(messages,'Duplicate SKU/location opening balance'); end if;
  end if;
  if nullif(trim(r->>'location'),'') is not null then
   if (select count(*) from public.locations where lower(trim(name))=lower(trim(r->>'location')))<>1 then messages:=array_append(messages,'Location is unknown or ambiguous');
   else select id into loc from public.locations where lower(trim(name))=lower(trim(r->>'location')); end if;
  elsif p_kind='opening' then messages:=array_append(messages,'Location is required'); end if;
  if p_kind='opening' and item.id is not null and loc is not null then
   if exists(select 1 from public.stock_balances where item_id=item.id and location_id=loc and quantity<>0) or exists(select 1 from public.movements where item_id=item.id and (from_location_id=loc or to_location_id=loc)) then messages:=array_append(messages,'Location already has stock history; receive stock instead'); end if;
  end if;
  if cardinality(messages)>0 then errors:=errors||jsonb_build_array(jsonb_build_object('row',n+1,'messages',to_jsonb(messages))); end if;
 end loop;
 return jsonb_build_object('errors',errors,'rows',n);
end $$;

create function public.commit_inventory_import(p_request uuid,p_kind text,p_rows jsonb,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.inventory_imports%rowtype; validation jsonb; r jsonb; loc uuid; item_id uuid; movement_id uuid; result jsonb:='[]'; n integer:=0;
begin
 perform public.require_office_role(array['admin']);
 if p_confirm is distinct from true or p_request is null then raise exception 'Explicit confirmation and request ID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory-import:'||p_request::text,0));
 select * into previous from public.inventory_imports where id=p_request;
 if found then
  if previous.actor_id<>auth.uid() or previous.kind<>p_kind or previous.payload is distinct from p_rows then raise exception 'Import request ID already used for a different file'; end if;
  return previous.result;
 end if;
 -- Same lock order as count approval; prevents stock writes during opening validation.
 lock table public.items in exclusive mode;
 lock table public.locations in share mode;
 validation:=public.validate_inventory_import(p_kind,p_rows);
 if jsonb_array_length(validation->'errors')>0 then raise exception 'Import validation failed' using detail=validation::text; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  n:=n+1; loc:=null; movement_id:=null;
  select id into loc from public.locations where lower(trim(name))=lower(trim(r->>'location'));
  if p_kind='items' then
   item_id:=public.create_item(trim(r->>'name'),trim(r->>'sku'),trim(r->>'category'),trim(r->>'unit'),(r->>'minimum')::integer,(r->>'unit_cost')::numeric,loc,coalesce(r->>'description',''),nullif(trim(r->>'barcode'),''),nullif(trim(r->>'supplier'),''));
  else
   select id into item_id from public.items where lower(sku)=lower(trim(r->>'sku'));
   movement_id:=public.post_movement(md5(p_request::text||':'||n)::uuid,item_id,'add',(r->>'quantity')::integer,null,loc,'Opening stock import: '||trim(r->>'reason'),nullif(trim(r->>'notes'),''));
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('row',n+1,'item_id',item_id,'movement_id',movement_id));
 end loop;
 result:=jsonb_build_object('id',p_request,'kind',p_kind,'rows',n,'records',result);
 insert into public.inventory_imports(id,actor_id,kind,payload,result) values(p_request,auth.uid(),p_kind,p_rows,result);
 return result;
end $$;
revoke all on function public.validate_inventory_import(text,jsonb),public.commit_inventory_import(uuid,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.validate_inventory_import(text,jsonb),public.commit_inventory_import(uuid,text,jsonb,boolean) to authenticated;
commit;
