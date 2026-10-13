\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('test.csv_items','[{"name":"CSV pens","sku":"CSV-PENS","barcode":"000888","category":"Office","description":"Imported","unit":"boxes","unit_cost":"2.50","supplier":"","minimum":"2","location":""}]',false);
select commit_inventory_import('88888888-8888-8888-8888-888888888881','items',current_setting('test.csv_items')::jsonb,true);
select commit_inventory_import('88888888-8888-8888-8888-888888888881','items',current_setting('test.csv_items')::jsonb,true);
select id as csv_location from locations order by name,id limit 1 \gset
select set_config('test.csv_location',:'csv_location',false);
select set_config('test.csv_opening',(select jsonb_build_array(jsonb_build_object('sku','CSV-PENS','location',name,'quantity','7','reason','Initial office count','notes','CSV audit'))::text from locations where id=:'csv_location'),false);
select commit_inventory_import('88888888-8888-8888-8888-888888888882','opening',current_setting('test.csv_opening')::jsonb,true);
select commit_inventory_import('88888888-8888-8888-8888-888888888882','opening',current_setting('test.csv_opening')::jsonb,true);
do $$ declare item uuid; snap jsonb; valid jsonb;begin
 select id into item from items where sku='CSV-PENS';
 if (select count(*) from items where sku='CSV-PENS')<>1 then raise exception 'Item retry duplicated';end if;
 if (select quantity from items where id=item)<>7 or (select count(*) from movements where item_id=item)<>1 then raise exception 'Opening retry duplicated stock';end if;
 if not exists(select 1 from movements where item_id=item and actor_id=auth.uid() and reason like 'Opening stock import:%' and notes='CSV audit') then raise exception 'Import missing audit movement';end if;
 if (select cost from item_costs where item_id=item)<>2.50 then raise exception 'Cost import failed';end if;
 snap:=inventory_snapshot();if not exists(select 1 from jsonb_array_elements(snap->'items') x where x->>'sku'='CSV-PENS' and (x->>'cost')::numeric=2.50) then raise exception 'Admin snapshot missing cost';end if;
 valid:=validate_inventory_import('opening',current_setting('test.csv_opening')::jsonb);if jsonb_array_length(valid->'errors')<>1 then raise exception 'Existing stock not rejected';end if;
 valid:=validate_inventory_import('items','[{"name":"Bad","sku":"CSV-PENS","barcode":"000888","category":"Office","unit":"boxes","unit_cost":"-1","minimum":"1.5","location":"Unknown"}]');if jsonb_array_length(valid->'errors')<>1 or (valid->'errors'->0->>'row')::int<>2 then raise exception 'Row errors absent';end if;
 begin perform commit_inventory_import(gen_random_uuid(),'items',current_setting('test.csv_items')::jsonb,false);raise exception 'Confirmation bypassed';exception when raise_exception then if sqlerrm<>'Explicit confirmation and request ID required' then raise;end if;end;
 begin perform commit_inventory_import('88888888-8888-8888-8888-888888888881','items','[]',true);raise exception 'Payload key reused';exception when raise_exception then if sqlerrm<>'Import request ID already used for a different file' then raise;end if;end;
 -- One invalid row aborts all rows, including the valid one.
 begin perform commit_inventory_import(gen_random_uuid(),'items','[{"name":"Valid","sku":"CSV-ROLLBACK","category":"Office","unit":"boxes","unit_cost":"0","minimum":"0","location":""},{"name":"Bad","sku":"CSV-FAIL","category":"Office","unit":"boxes","unit_cost":"bad","minimum":"0","location":""}]',true);raise exception 'Bad file accepted';exception when raise_exception then if sqlerrm<>'Import validation failed' then raise;end if;end;
 if exists(select 1 from items where sku='CSV-ROLLBACK') then raise exception 'Partial import persisted';end if;
 perform update_item(item,'CSV pens edited','CSV-PENS','000888','Office','Imported','boxes',4.75,null,2,null,null,(select updated_at from items where id=item));
 if (select cost from item_costs where item_id=item)<>4.75 then raise exception 'Cost edit failed after migration';end if;
end $$;
select test_denied('update item_costs set cost=0');
select test_denied('delete from inventory_imports');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select test_denied($q$select validate_inventory_import('items','[]')$q$);
select test_denied($q$select commit_inventory_import(gen_random_uuid(),'items','[]',true)$q$);
do $$ declare snapshot jsonb;begin
 if exists(select 1 from item_costs) or exists(select 1 from inventory_imports) then raise exception 'Staff cost/import leak';end if;
 snapshot:=inventory_snapshot();if exists(select 1 from jsonb_array_elements(snapshot->'items') x where x->>'cost' is not null) then raise exception 'Staff snapshot cost leak';end if;
 if exists(select 1 from jsonb_array_elements(inventory_snapshot_before_counts()->'items') x where x->>'cost' is not null) then raise exception 'Legacy snapshot cost leak';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='items' and column_name='cost') then raise exception 'Cost in shared realtime table';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin if exists(select 1 from item_costs) then raise exception 'Viewer cost leak';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $$ begin if exists(select 1 from item_costs) or exists(select 1 from inventory_imports) or inventory_snapshot() is not null then raise exception 'Deactivated report data leak';end if;end $$;
reset role;
select 'PASS: CSV atomic imports, row validation, explicit confirmation, audited opening stock, retries, admin cost isolation and revoked access' as result;
