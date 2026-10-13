\set ON_ERROR_STOP on
-- auth.users and Supabase roles are test doubles; all app policies/RPCs are the actual migrations.
update auth.users set email='admin@example.test',email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000001';
update members set active=true where id='00000000-0000-0000-0000-000000000002';
insert into auth.users(id,email,email_confirmed_at,invited_at) values
('00000000-0000-0000-0000-000000000005','invited@example.test',now(),now()),
('00000000-0000-0000-0000-000000000006','uninvited@example.test',now(),null),
('00000000-0000-0000-0000-000000000007','unverified@example.test',null,now()),
('00000000-0000-0000-0000-000000000008','expired@example.test',now(),now()),
('00000000-0000-0000-0000-000000000009','revoked@example.test',now(),now());
insert into locations(id,name) values ('22222222-2222-2222-2222-222222222222','Destination');

-- Exercise SQLSTATE checks, not broad exception swallowing.
create function public.test_denied(command text) returns void language plpgsql as $$
begin
  begin execute command; exception when insufficient_privilege then return; end;
  raise exception 'Expected insufficient_privilege for %',command;
end $$;
grant execute on function public.test_denied(text) to authenticated,anon;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select test_denied($q$select prepare_invitation('any@example.test','Any','admin')$q$);
select test_denied($q$select transfer_stock('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','22222222-2222-2222-2222-222222222222',1,'Viewer attack')$q$);
select test_denied($q$insert into members values (auth.uid(),'Self','admin',true)$q$);
select test_denied($q$update members set role='admin' where id=auth.uid()$q$);
select test_denied($q$select finish_invitation(gen_random_uuid(),auth.uid())$q$);
select test_denied($q$select require_office_role(array['viewer'])$q$);
select test_denied($q$insert into locations(name) values('Unauthorized')$q$);
select test_denied($q$update stock_balances set quantity=999$q$);
do $$ begin if exists(select 1 from invitations) then raise exception 'Viewer can read invitations'; end if; end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select test_denied($q$select create_item('Attack','ATTACK','Office supplies','units',5,0,null,'')$q$);
select test_denied($q$select record_stock('11111111-1111-1111-1111-111111111111','adjust',99,'Staff count')$q$);
select test_denied($q$select prepare_invitation('any@example.test','Any','admin')$q$);
select transfer_stock('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','22222222-2222-2222-2222-222222222222',2,'Room restock');
do $$ begin
  if (select quantity from items where sku='TEST-001')<>6 then raise exception 'Transfer changed office total'; end if;
  if (select quantity from stock_balances where location_id='22222222-2222-2222-2222-222222222221')<>4 then raise exception 'Source wrong'; end if;
  if (select quantity from stock_balances where location_id='22222222-2222-2222-2222-222222222222')<>2 then raise exception 'Destination wrong'; end if;
  if not exists(select 1 from movements where kind='transfer' and delta=0 and transfer_quantity=2 and actor_id=auth.uid() and source_before=6 and source_after=4) then raise exception 'Transfer audit wrong'; end if;
  begin
    perform transfer_stock('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','22222222-2222-2222-2222-222222222222',5,'Overdraw');
    raise exception 'Overdraw allowed';
  exception when raise_exception then if sqlerrm<>'Not enough stock at source location' then raise; end if; end;
  if (select quantity from stock_balances where location_id='22222222-2222-2222-2222-222222222221')<>4 then raise exception 'Failed transfer not atomic'; end if;
end $$;
select record_stock('11111111-1111-1111-1111-111111111111','remove',1,'Issued at destination','22222222-2222-2222-2222-222222222222');
select record_stock('11111111-1111-1111-1111-111111111111','add',1,'Received at destination','22222222-2222-2222-2222-222222222222');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select prepare_invitation('INVITED@example.test','Invited person','staff') as invite_id \gset
select prepare_invitation('unverified@example.test','Unverified','viewer') as unverified_id \gset
select prepare_invitation('expired@example.test','Expired','viewer') as expired_id \gset
select prepare_invitation('revoked@example.test','Revoked','viewer') as revoked_id \gset
select create_item('Admin item','ADMIN-001','Office supplies','units',5,1,null,'Admin only');
do $$ begin
  begin perform set_member('00000000-0000-0000-0000-000000000006','Uninvited','admin',true);raise exception 'Uninvited enrollment allowed';
  exception when raise_exception then if sqlerrm<>'Invite new users first' then raise; end if; end;
  begin perform set_member(auth.uid(),'Me','viewer',false);raise exception 'Self-deactivation allowed';
  exception when raise_exception then if sqlerrm<>'You cannot change your own membership' then raise; end if; end;
end $$;
reset role;
set role service_role;
select finish_invitation(:'invite_id','00000000-0000-0000-0000-000000000005');
select finish_invitation(:'unverified_id','00000000-0000-0000-0000-000000000007');
select finish_invitation(:'expired_id','00000000-0000-0000-0000-000000000008');
select finish_invitation(:'revoked_id','00000000-0000-0000-0000-000000000009');
update invitations set expires_at=now()-interval '1 second' where id=:'expired_id';
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select revoke_invitation(:'revoked_id');

-- Forged JWT/user metadata does not create membership. Acceptance takes zero role arguments.
select set_config('request.jwt.claims','{"role":"admin","user_metadata":{"role":"admin"}}',false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
do $$ begin
  if office_role() is not null or exists(select 1 from items) then raise exception 'Forged metadata granted access'; end if;
  begin perform accept_invitation();raise exception 'Uninvited acceptance allowed';
  exception when raise_exception then if sqlerrm<>'No valid invitation for this account' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',false);
do $$ begin begin perform accept_invitation();raise exception 'Unverified acceptance allowed';exception when raise_exception then if sqlerrm<>'No valid invitation for this account' then raise; end if; end; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000008',false);
do $$ begin begin perform accept_invitation();raise exception 'Expired acceptance allowed';exception when raise_exception then if sqlerrm<>'No valid invitation for this account' then raise; end if; end; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000009',false);
do $$ begin begin perform accept_invitation();raise exception 'Revoked acceptance allowed';exception when raise_exception then if sqlerrm<>'No valid invitation for this account' then raise; end if; end; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
select accept_invitation();
do $$ begin
  if office_role()<>'staff' then raise exception 'Role was not taken from invitation'; end if;
  if not exists(select 1 from items) then raise exception 'Accepted member cannot read'; end if;
  begin perform accept_invitation();raise exception 'Invitation replay allowed';exception when raise_exception then if sqlerrm<>'No valid invitation for this account' then raise; end if; end;
end $$;

-- Reuse the same JWT subject after deactivation: no fresh token is required to revoke access.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_member('00000000-0000-0000-0000-000000000005','Invited person','staff',false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $$ begin
  if office_role() is not null or exists(select 1 from items) or exists(select 1 from stock_balances) or exists(select 1 from locations) or exists(select 1 from movements) or exists(select 1 from members) then raise exception 'Deactivated user can read data'; end if;
end $$;
select test_denied($q$select record_stock('11111111-1111-1111-1111-111111111111','add',1,'Deactivated attack')$q$);
select test_denied($q$select transfer_stock('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','22222222-2222-2222-2222-222222222222',1,'Deactivated attack')$q$);
reset role;
set role anon;
select test_denied($q$select accept_invitation()$q$);
select test_denied($q$select office_role()$q$);
select test_denied($q$select * from stock_balances$q$);
select test_denied($q$select * from invitations$q$);
reset role;
select 'PASS: invitation-only enrollment, role restrictions, forged metadata denial, invite verification/expiry/revocation/replay, transfers, and deactivation with an existing identity' as result;
