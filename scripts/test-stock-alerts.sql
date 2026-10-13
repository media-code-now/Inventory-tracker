\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select create_item('Alert test','ALERT-001','Office supplies','units',5,1,'22222222-2222-2222-2222-222222222221','',p_id=>'88888888-8888-8888-8888-888888888888');
select post_movement(gen_random_uuid(),'88888888-8888-8888-8888-888888888888','add',3,null,'22222222-2222-2222-2222-222222222221','Receive low stock');
select id as low_alert from stock_alerts where item_id='88888888-8888-8888-8888-888888888888' and resolved_at is null \gset
select post_movement(gen_random_uuid(),'88888888-8888-8888-8888-888888888888','add',1,null,'22222222-2222-2222-2222-222222222221','Still low');
select set_config('test.low_alert',:'low_alert',false);
do $$ begin
 if (select count(*) from stock_alerts where item_id='88888888-8888-8888-8888-888888888888' and resolved_at is null)<>1 then raise exception 'Duplicate open alerts';end if;
 if not exists(select 1 from stock_alerts where id=current_setting('test.low_alert')::uuid and resolved_at is null and condition='low_stock') then raise exception 'Unresolved condition changed alert identity';end if;
end $$;
select post_movement(gen_random_uuid(),'88888888-8888-8888-8888-888888888888','add',2,null,'22222222-2222-2222-2222-222222222221','Replenished');
do $$ begin if exists(select 1 from stock_alerts where item_id='88888888-8888-8888-8888-888888888888' and resolved_at is null) then raise exception 'Replenished alert not resolved';end if;end $$;
select post_movement(gen_random_uuid(),'88888888-8888-8888-8888-888888888888','remove',6,'22222222-2222-2222-2222-222222222221',null,'Used all stock');
do $$ declare snapshot jsonb; begin
 if not exists(select 1 from stock_alerts where item_id='88888888-8888-8888-8888-888888888888' and condition='out_of_stock' and resolved_at is null) then raise exception 'Zero condition not separate';end if;
 if exists(select 1 from stock_alerts where item_id='88888888-8888-8888-8888-888888888888' and condition='low_stock' and resolved_at is null) then raise exception 'Zero classified as low stock';end if;
 snapshot:=inventory_snapshot();if not exists(select 1 from jsonb_array_elements(snapshot->'alerts') a where a->>'item_id'='88888888-8888-8888-8888-888888888888') then raise exception 'Snapshot missing alert';end if;
 perform set_item_archived('88888888-8888-8888-8888-888888888888',true,(select updated_at from items where sku='ALERT-001'));
 if exists(select 1 from stock_alerts where item_id='88888888-8888-8888-8888-888888888888' and resolved_at is null) then raise exception 'Archive did not resolve alert';end if;
 if (select count(*) from stock_alerts where item_id='88888888-8888-8888-8888-888888888888')<>3 then raise exception 'Alert history lost';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select test_denied($q$insert into stock_alerts(item_id,condition) values ('88888888-8888-8888-8888-888888888888','low_stock')$q$);
select test_denied('update stock_alerts set resolved_at=now()');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $$ begin if exists(select 1 from stock_alerts) then raise exception 'Deactivated user sees alerts';end if;end $$;
reset role;
select 'PASS: persistent deduplicated alerts, replenishment resolution, zero-stock transition, archive resolution, snapshot and RLS' as result;
