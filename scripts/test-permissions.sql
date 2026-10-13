\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000004');
insert into members values ('00000000-0000-0000-0000-000000000001','Admin','admin',true),('00000000-0000-0000-0000-000000000002','Staff','staff',true),('00000000-0000-0000-0000-000000000003','Viewer','viewer',true);
insert into items(id,name,sku,category) values ('11111111-1111-1111-1111-111111111111','Test paper','TEST-001','Office supplies');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
do $$ begin if (select count(*) from items)<>0 then raise exception 'Non-member can read stock'; end if; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin
 begin perform record_stock('11111111-1111-1111-1111-111111111111','add',5,'Viewer attempt'); raise exception 'Viewer wrote stock'; exception when raise_exception then if sqlerrm='Viewer wrote stock' then raise; end if; end;
 begin update items set quantity=999; raise exception 'Direct quantity write allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select record_stock('11111111-1111-1111-1111-111111111111','add',10,'Initial delivery');
select record_stock('11111111-1111-1111-1111-111111111111','remove',3,'Office use');
select record_stock('11111111-1111-1111-1111-111111111111','adjust',6,'Physical count');
do $$ begin
 if (select quantity from items limit 1)<>6 then raise exception 'Wrong final stock'; end if;
 if (select count(*) from movements)<>3 then raise exception 'Wrong ledger count'; end if;
 if exists(select 1 from movements where actor_id<>auth.uid()) then raise exception 'Actor identity mismatch'; end if;
 begin perform record_stock('11111111-1111-1111-1111-111111111111','remove',7,'Overdraw'); raise exception 'Negative stock allowed'; exception when raise_exception then if sqlerrm='Negative stock allowed' then raise; end if; end;
 if (select quantity from items limit 1)<>6 or (select count(*) from movements)<>3 then raise exception 'Failed change was not atomic'; end if;
 begin perform record_stock('11111111-1111-1111-1111-111111111111','add',1,' '); raise exception 'Empty reason allowed'; exception when raise_exception then if sqlerrm='Empty reason allowed' then raise; end if; end;
 begin delete from movements; raise exception 'Ledger deletion allowed'; exception when insufficient_privilege then null; end;
 begin perform set_member('00000000-0000-0000-0000-000000000003','Viewer','admin',true); raise exception 'Staff escalated role'; exception when raise_exception then if sqlerrm='Staff escalated role' then raise; end if; end;
end $$;
reset role;
update members set active=false where id='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$ begin if (select count(*) from items)<>0 then raise exception 'Disabled member can read'; end if; end $$;
reset role;
set role anon;
do $$ begin
 begin perform * from items; raise exception 'Anonymous read allowed'; exception when insufficient_privilege then null; end;
 begin perform record_stock('11111111-1111-1111-1111-111111111111','add',1,'Anon'); raise exception 'Anonymous RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: member access, role restrictions, actor audit, atomic changes, no negative stock, immutable ledger, and disabled/anonymous denial' as result;
