\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ declare snapshot jsonb; total integer; summed integer; begin
 snapshot:=inventory_snapshot();
 if snapshot is null or jsonb_array_length(snapshot->'items')=0 or snapshot->>'confirmed_at' is null then raise exception 'Missing confirmed snapshot';end if;
 if jsonb_array_length(snapshot->'invitations')<>0 then raise exception 'Staff snapshot leaks invitations';end if;
 for total,summed in select (i->>'quantity')::integer,coalesce((select sum((b->>'quantity')::integer) from jsonb_array_elements(snapshot->'balances') b where b->>'item_id'=i->>'id'),0) from jsonb_array_elements(snapshot->'items') i loop
  if total<>summed then raise exception 'Snapshot stock totals differ from location balances';end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(snapshot->'movements') m where m->>'kind'='return') then raise exception 'Snapshot missing activity';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin if inventory_snapshot() is null then raise exception 'Viewer cannot read';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $$ begin if inventory_snapshot() is not null then raise exception 'Deactivated member can read snapshot';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
do $$ begin if inventory_snapshot() is not null then raise exception 'Non-member can read snapshot';end if;end $$;
reset role;
set role anon;
select test_denied('select inventory_snapshot()');
reset role;
select 'PASS: coherent confirmed inventory snapshot, activity, active membership, invitation RLS and anonymous denial' as result;
