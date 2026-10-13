\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select record_application_error('77777777-7777-7777-7777-777777777771','operation_failed','inventory');
select record_application_error('77777777-7777-7777-7777-777777777771','operation_failed','inventory');
do $$ begin
 if exists(select 1 from application_errors) then raise exception 'Staff can read diagnostics';end if;
 begin perform record_application_error(gen_random_uuid(),'private email or token','app');raise exception 'Unstructured private error accepted';exception when check_violation then null;end;
end $$;
select test_denied('insert into application_errors(id,actor_id,code,area) values(gen_random_uuid(),auth.uid(),''ui_crash'',''app'')');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
 if (select count(*) from application_errors where id='77777777-7777-7777-7777-777777777771')<>1 then raise exception 'Duplicate diagnostic or missing record';end if;
 if not exists(select 1 from application_errors where actor_id='00000000-0000-0000-0000-000000000002') then raise exception 'Actor not derived from JWT';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin for i in 1..12 loop perform record_application_error(gen_random_uuid(),'ui_crash','app');end loop;if exists(select 1 from application_errors) then raise exception 'Viewer diagnostic leak';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin if (select count(*) from application_errors where actor_id='00000000-0000-0000-0000-000000000003')<>10 then raise exception 'Diagnostic rate limit failed';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
select test_denied($q$select record_application_error(gen_random_uuid(),'ui_crash','app')$q$);
reset role;
select 'PASS: authenticated structured logging, server actor, admin-only diagnostics, idempotency, rate limiting and deactivated denial' as result;
