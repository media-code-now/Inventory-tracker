\set ON_ERROR_STOP on
-- Earlier role and invitation tests have already applied every real migration.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select create_item('Barcode item','SKU-UNIQUE','Special supplies','boxes',4,12.25,
  '22222222-2222-2222-2222-222222222221','Detailed description','000123456','Office supplier') as item_id \gset
select create_item('Optional item','SKU-OPTIONAL','Special supplies','units',0,0,null,'') as optional_id \gset
select record_stock(:'item_id','add',8,'Opening source quantity','22222222-2222-2222-2222-222222222221');
select record_stock(:'item_id','add',3,'Opening destination quantity','22222222-2222-2222-2222-222222222222');
select set_config('test.item_id', :'item_id', false);
select set_config('test.optional_id', :'optional_id', false);

-- Constraints remain authoritative even when validation in the browser is bypassed.
do $$
declare item_id uuid:=current_setting('test.item_id')::uuid; optional_id uuid:=current_setting('test.optional_id')::uuid;
  before_item public.items%rowtype; after_item public.items%rowtype;
begin
  select * into before_item from public.items where id=item_id;
  if before_item.quantity<>11 then raise exception 'Opening balances wrong'; end if;
  if (select sum(quantity) from public.stock_balances where stock_balances.item_id=before_item.id)<>11 then raise exception 'Per-location totals wrong'; end if;
  if (select count(*) from public.movements where movements.item_id=before_item.id)<>2 then raise exception 'Opening quantities bypassed ledger'; end if;
  begin perform create_item('Duplicate','sku-unique','Other','units',1,0,null,'');raise exception 'Case-insensitive duplicate SKU accepted';exception when unique_violation then null;end;
  begin perform create_item('Duplicate','SKU-OTHER','Other','units',1,0,null,'','000123456');raise exception 'Duplicate barcode accepted';exception when unique_violation then null;end;
  begin perform create_item('Invalid',' ','Other','units',1,0,null,'');raise exception 'Empty SKU accepted';exception when check_violation then null;end;
  begin perform create_item('Invalid','SKU-NEGATIVE','Other','units',-1,0,null,'');raise exception 'Negative threshold accepted';exception when check_violation then null;end;
  begin perform create_item('Invalid','SKU-COST','Other','units',1,-1,null,'');raise exception 'Negative cost accepted';exception when check_violation then null;end;
  begin perform create_item('Invalid','SKU-NAN','Other','units',1,'NaN'::numeric,null,'');raise exception 'NaN cost accepted';exception when check_violation then null;end;
  begin perform create_item('Invalid','SKU-NOUNIT','Other',' ',1,0,null,'');raise exception 'Empty unit accepted';exception when check_violation then null;end;
  perform update_item(item_id,'Edited item','SKU-UNIQUE','000123456','Special supplies','Changed description','boxes',15.5,'New supplier',6,
    '22222222-2222-2222-2222-222222222222',null,before_item.updated_at);
  select * into after_item from public.items where id=item_id;
  if after_item.quantity<>before_item.quantity or (select count(*) from public.movements where movements.item_id=before_item.id)<>2 then raise exception 'Metadata edit changed stock/history'; end if;
  if after_item.created_at<>before_item.created_at or after_item.updated_at<=before_item.updated_at then raise exception 'Item timestamps not maintained'; end if;
  if after_item.supplier<>'New supplier' or after_item.cost<>15.5 then raise exception 'Metadata edit failed'; end if;
  if (select quantity from public.stock_balances where stock_balances.item_id=before_item.id and location_id='22222222-2222-2222-2222-222222222221')<>8 then raise exception 'Default location edit moved stock'; end if;
  begin perform update_item(item_id,'Stale overwrite','SKU-UNIQUE',null,'Other','','units',0,null,0,null,null,before_item.updated_at);raise exception 'Stale edit allowed';exception when serialization_failure then null;end;
  perform set_item_archived(item_id,true,after_item.updated_at);
  select * into after_item from public.items where id=item_id;
  if after_item.status<>'archived' or after_item.archived_at is null or after_item.quantity<>11 then raise exception 'Archive changed stock'; end if;
  if (select count(*) from public.movements where movements.item_id=before_item.id)<>2 or (select count(*) from public.stock_balances where stock_balances.item_id=before_item.id)<>2 then raise exception 'Archive deleted historical data'; end if;
  begin perform create_item('Identifier reuse','SKU-UNIQUE','Other','units',0,0,null,'');raise exception 'Archived SKU reused';exception when unique_violation then null;end;
  begin perform create_item('Barcode reuse','SKU-NEW','Other','units',0,0,null,'','000123456');raise exception 'Archived barcode reused';exception when unique_violation then null;end;
  begin perform record_stock(item_id,'add',1,'Archived attempt');raise exception 'Archived stock changed';exception when raise_exception then if sqlerrm<>'Archived items cannot receive stock movements. Restore the item first.' then raise;end if;end;
  begin perform transfer_stock(item_id,'22222222-2222-2222-2222-222222222221','22222222-2222-2222-2222-222222222222',1,'Archived transfer');raise exception 'Archived stock transferred';exception when raise_exception then if sqlerrm<>'Archived items cannot receive stock movements. Restore the item first.' then raise;end if;end;
  if (select quantity from public.items where id=item_id)<>11 or (select sum(quantity) from public.stock_balances where stock_balances.item_id=before_item.id)<>11 then raise exception 'Archived movement not rolled back';end if;
  select * into after_item from public.items where id=item_id;
  perform set_item_archived(item_id,false,after_item.updated_at);
  if (select status from public.items where id=item_id)<>'active' then raise exception 'Restore failed';end if;
  if (select archived_at from public.items where id=item_id) is not null then raise exception 'Restore left archive timestamp';end if;
  perform record_stock(item_id,'remove',1,'Issue after restore','22222222-2222-2222-2222-222222222221');
  if (select quantity from public.items where id=item_id)<>10 then raise exception 'Restored item cannot transact';end if;
  if (select quantity from public.items where id=optional_id)<>0 or exists(select 1 from public.movements where movements.item_id=optional_id) then raise exception 'New item did not start at zero';end if;
end $$;
select test_denied($q$update items set quantity=999$q$);
select test_denied($q$update stock_balances set quantity=999$q$);
select test_denied($q$delete from items$q$);
select test_denied($q$delete from movements$q$);

-- Private image bucket policies and item-specific object binding.
insert into storage.objects(bucket_id,name) values ('item-images','items/'||:'item_id'||'/33333333-3333-3333-3333-333333333333.png');
do $$
declare i public.items%rowtype;
begin
  select * into i from public.items where id=current_setting('test.item_id')::uuid;
  perform update_item(i.id,i.name,i.sku,i.barcode,i.category,i.description,i.unit,i.cost,i.supplier,i.minimum,i.location_id,
    'items/'||i.id||'/33333333-3333-3333-3333-333333333333.png',i.updated_at);
  select * into i from public.items where id=current_setting('test.optional_id')::uuid;
  begin perform update_item(i.id,i.name,i.sku,i.barcode,i.category,i.description,i.unit,i.cost,i.supplier,i.minimum,i.location_id,
    'items/'||current_setting('test.item_id')||'/33333333-3333-3333-3333-333333333333.png',i.updated_at);
    raise exception 'Image bound to wrong item';
  exception when raise_exception then if sqlerrm<>'Upload a valid image for this item first' then raise;end if;end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select test_denied($q$select set_item_archived(current_setting('test.item_id')::uuid,true,now())$q$);
select test_denied($q$select update_item(current_setting('test.item_id')::uuid,'Attack','ATTACK',null,'Other','','units',0,null,0,null,null,now())$q$);
select test_denied($q$insert into storage.objects(bucket_id,name) values ('item-images','items/44444444-4444-4444-4444-444444444444/33333333-3333-3333-3333-333333333333.png')$q$);
do $$ begin if not exists(select 1 from storage.objects) then raise exception 'Active staff cannot read linked image';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select test_denied($q$select set_item_archived(current_setting('test.item_id')::uuid,true,now())$q$);
select test_denied($q$select update_item(current_setting('test.item_id')::uuid,'Attack','ATTACK',null,'Other','','units',0,null,0,null,null,now())$q$);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $$ begin if exists(select 1 from storage.objects) then raise exception 'Disabled user can read images';end if;end $$;
reset role;
set role anon;
do $$ begin if exists(select 1 from storage.objects) then raise exception 'Anon can read images';end if;exception when insufficient_privilege then null;end $$;
reset role;
-- Owner-level checks demonstrate database constraints also reject invalid direct writes.
do $$ begin
  begin update public.stock_balances set quantity=-1;raise exception 'Negative balance allowed';exception when check_violation then null;end;
  begin update public.items set quantity=-1;raise exception 'Negative aggregate allowed';exception when check_violation then null;end;
  if (select public from storage.buckets where id='item-images') then raise exception 'Image bucket public';end if;
end $$;
select 'PASS: item identifiers, required fields, numeric constraints, metadata-only edits, timestamps, location balances, archive/restore/history, role restrictions, and private image policies' as result;
