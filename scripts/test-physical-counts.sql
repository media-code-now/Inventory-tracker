\set ON_ERROR_STOP on
insert into locations(id,name) values ('99999999-9999-9999-9999-999999999991','Physical count test');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select create_item('Count item','COUNT-001','Test','units',2,1,'99999999-9999-9999-9999-999999999991','',p_id=>'99999999-9999-9999-9999-999999999992');
select post_movement(gen_random_uuid(),'99999999-9999-9999-9999-999999999992','add',10,null,'99999999-9999-9999-9999-999999999991','Opening');
select create_stock_count('99999999-9999-9999-9999-999999999993','99999999-9999-9999-9999-999999999991','Office physical count');
select start_stock_count('99999999-9999-9999-9999-999999999993');
select id as line_id from stock_count_lines where count_id='99999999-9999-9999-9999-999999999993' \gset
select set_config('test.count_line',:'line_id',false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select save_counted_quantity(:'line_id',8,0,'Shelf counted by staff');
select test_denied($q$select approve_stock_count('99999999-9999-9999-9999-999999999993','Unauthorized')$q$);
select test_denied($q$select start_stock_count('99999999-9999-9999-9999-999999999993')$q$);
do $$ begin
 if (select quantity from items where sku='COUNT-001')<>10 then raise exception 'Count entry silently changed stock';end if;
 begin perform save_counted_quantity(current_setting('test.count_line')::uuid,99,0,'Stale');raise exception 'Stale count entry allowed';exception when serialization_failure then null;end;
end $$;
select submit_stock_count('99999999-9999-9999-9999-999999999993');
-- Movement after submission: even an offsetting receive/issue must invalidate the baseline.
select post_movement(gen_random_uuid(),'99999999-9999-9999-9999-999999999992','remove',1,'99999999-9999-9999-9999-999999999991',null,'During counting');
select post_movement(gen_random_uuid(),'99999999-9999-9999-9999-999999999992','return',1,null,'99999999-9999-9999-9999-999999999991','Offsetting return');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare snapshot jsonb;begin
 snapshot:=inventory_snapshot();
 if not exists(select 1 from jsonb_array_elements(snapshot->'count_lines') l where l->>'count_id'='99999999-9999-9999-9999-999999999993' and (l->>'needs_recount')::boolean) then raise exception 'Net-zero later movement not flagged';end if;
 begin perform approve_stock_count('99999999-9999-9999-9999-999999999993','Approve stale');raise exception 'Stale count approved';exception when raise_exception then if sqlerrm<>'Stock moved or an item changed after its snapshot. Recount affected items before approval' then raise;end if;end;
 if (select state from stock_counts where id='99999999-9999-9999-9999-999999999993')<>'awaiting_approval' then raise exception 'Failed approval changed state';end if;
end $$;
select refresh_count_snapshot('99999999-9999-9999-9999-999999999993','99999999-9999-9999-9999-999999999992','Recount after movement');
do $$ begin
 if (select expected_quantity from stock_count_lines where id=current_setting('test.count_line')::uuid)<>10 then raise exception 'Original expected quantity overwritten';end if;
 if (select counted_quantity from stock_count_lines where id=current_setting('test.count_line')::uuid) is not null then raise exception 'Recount retained obsolete measurement';end if;
 if (select count(*) from stock_count_entries where line_id=current_setting('test.count_line')::uuid)<>2 then raise exception 'Recount audit missing';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select save_counted_quantity(:'line_id',9,2,'Physically recounted');
select submit_stock_count('99999999-9999-9999-9999-999999999993');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select approve_stock_count('99999999-9999-9999-9999-999999999993','Verified recount');
select approve_stock_count('99999999-9999-9999-9999-999999999993','Retry completed approval');
do $$ declare line public.stock_count_lines%rowtype;begin
 select * into line from stock_count_lines where id=current_setting('test.count_line')::uuid;
 if (select quantity from items where sku='COUNT-001')<>9 then raise exception 'Approved quantity wrong';end if;
 if not exists(select 1 from movements where id=line.adjustment_id and kind='adjust' and delta=-1 and actor_id=auth.uid() and notes like '%99999999-9999-9999-9999-999999999993%') then raise exception 'Auditable adjustment link missing';end if;
 if (select count(*) from movements where item_id=line.item_id and kind='adjust')<>1 then raise exception 'Approval posted twice';end if;
 if (select state from stock_counts where id=line.count_id)<>'completed' then raise exception 'Count not completed';end if;
end $$;
select test_denied('update stock_count_lines set counted_quantity=999');
select test_denied('delete from stock_counts');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select test_denied($q$select save_counted_quantity(current_setting('test.count_line')::uuid,1,3,'Viewer')$q$);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $$ begin if exists(select 1 from stock_counts) or inventory_snapshot() is not null then raise exception 'Disabled count data leak';end if;end $$;
reset role;
select 'PASS: count states, original snapshots, staff entries, stale-entry denial, net-zero movement conflicts, recount history, admin approval, linked adjustments and approval retry safety' as result;
