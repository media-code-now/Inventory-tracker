\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select create_item('Transaction item','TX-001','Office supplies','units',2,1,'22222222-2222-2222-2222-222222222221','',p_id=>'55555555-5555-5555-5555-555555555555');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select post_movement('66666666-6666-6666-6666-666666666661','55555555-5555-5555-5555-555555555555','add',10,null,'22222222-2222-2222-2222-222222222221','Delivery','10 units received') as received \gset
select post_movement('66666666-6666-6666-6666-666666666662','55555555-5555-5555-5555-555555555555','remove',3,'22222222-2222-2222-2222-222222222221',null,'Consumed','Meeting supplies','Finance / Jordan') as issued \gset
select post_movement('66666666-6666-6666-6666-666666666663','55555555-5555-5555-5555-555555555555','return',2,null,'22222222-2222-2222-2222-222222222221','Unused supplies returned') as returned \gset
select post_movement('66666666-6666-6666-6666-666666666663','55555555-5555-5555-5555-555555555555','return',2,null,'22222222-2222-2222-2222-222222222221','Unused supplies returned') as retried \gset
select :'returned'=:'retried' as same_id \gset
\if :same_id
\else
\quit 1
\endif
select post_movement('66666666-6666-6666-6666-666666666664','55555555-5555-5555-5555-555555555555','transfer',4,'22222222-2222-2222-2222-222222222221','22222222-2222-2222-2222-222222222222','Room restock') as transferred \gset
select test_denied($q$select post_movement(gen_random_uuid(),'55555555-5555-5555-5555-555555555555','adjust',99,null,'22222222-2222-2222-2222-222222222221','Staff adjustment')$q$);
select test_denied($q$select post_movement(gen_random_uuid(),'55555555-5555-5555-5555-555555555555','reversal',null,null,null,'Staff correction')$q$);
select test_denied($q$select record_stock('55555555-5555-5555-5555-555555555555','add',99,'Legacy bypass')$q$);
select test_denied($q$select transfer_stock('55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222221','22222222-2222-2222-2222-222222222222',1,'Legacy bypass')$q$);
do $$ begin
 if (select quantity from items where sku='TX-001')<>9 or (select count(*) from movements where item_id='55555555-5555-5555-5555-555555555555')<>4 then raise exception 'Posting or deduplication incorrect';end if;
 if not exists(select 1 from movements where kind='remove' and recipient='Finance / Jordan' and notes='Meeting supplies' and actor_id=auth.uid()) then raise exception 'Transaction fields missing';end if;
 begin perform post_movement('66666666-6666-6666-6666-666666666663','55555555-5555-5555-5555-555555555555','return',3,null,'22222222-2222-2222-2222-222222222221','Different request');raise exception 'Key reused';exception when raise_exception then if sqlerrm<>'Request ID already used for different transaction details' then raise;end if;end;
 begin perform post_movement(gen_random_uuid(),'55555555-5555-5555-5555-555555555555','remove',6,'22222222-2222-2222-2222-222222222221',null,'Overdraw');raise exception 'Negative stock';exception when raise_exception then if sqlerrm<>'Not enough stock at source location' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select post_movement('66666666-6666-6666-6666-666666666665','55555555-5555-5555-5555-555555555555','adjust',1,null,'22222222-2222-2222-2222-222222222221','Physical count') as adjusted \gset
select post_movement('66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555','reversal',null,null,null,'Count was entered incorrectly',p_reverses=>:'adjusted');
select post_movement('66666666-6666-6666-6666-666666666667','55555555-5555-5555-5555-555555555555','reversal',null,null,null,'Issue was incorrect',p_reverses=>:'issued');
select post_movement('66666666-6666-6666-6666-666666666668','55555555-5555-5555-5555-555555555555','reversal',null,null,null,'Transfer was incorrect',p_reverses=>:'transferred');
select set_config('test.received',:'received',false);
select set_config('test.issued',:'issued',false);
do $$ begin
 if (select quantity from items where sku='TX-001')<>12 then raise exception 'Reversal reset later activity';end if;
 if (select quantity from stock_balances where item_id='55555555-5555-5555-5555-555555555555' and location_id='22222222-2222-2222-2222-222222222222')<>0 then raise exception 'Transfer reversal not atomic';end if;
 begin perform post_movement(gen_random_uuid(),'55555555-5555-5555-5555-555555555555','reversal',null,null,null,'Repeat reversal',p_reverses=>current_setting('test.issued')::uuid);raise exception 'Double reversal';exception when raise_exception then if sqlerrm<>'This movement has already been reversed' then raise;end if;end;
end $$;
reset role;
-- Force failure at ledger insert, after all quantity updates, to verify rollback.
create function public.test_ledger_failure() returns trigger language plpgsql as $$ begin if new.notes='force-ledger-failure' then raise exception 'Forced ledger failure';end if;return new;end $$;
create trigger test_ledger_failure before insert on movements for each row execute function public.test_ledger_failure();
set role authenticated;
do $$ begin
 begin perform post_movement(gen_random_uuid(),'55555555-5555-5555-5555-555555555555','add',100,null,'22222222-2222-2222-2222-222222222221','Failure test','force-ledger-failure');raise exception 'Failure missing';exception when raise_exception then if sqlerrm<>'Forced ledger failure' then raise;end if;end;
 if (select quantity from items where sku='TX-001')<>12 then raise exception 'Failed ledger left changed quantity';end if;
end $$;
reset role;
drop trigger test_ledger_failure on movements;
drop function test_ledger_failure();
do $$ begin
 begin update movements set reason='Edit attack' where item_id='55555555-5555-5555-5555-555555555555';raise exception 'Ledger mutable';exception when raise_exception then if sqlerrm<>'Posted movements are immutable; post a linked reversal instead' then raise;end if;end;
 begin delete from movements where item_id='55555555-5555-5555-5555-555555555555';raise exception 'Ledger deletable';exception when raise_exception then if sqlerrm<>'Posted movements are immutable; post a linked reversal instead' then raise;end if;end;
end $$;
select 'PASS: receive/issue/return/transfer/admin count, idempotency, fields, linked reversals, permissions, immutability, and forced-failure rollback' as result;
