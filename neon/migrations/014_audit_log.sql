-- Append-only change history: who changed what and when, written by triggers so no write path can skip it.
begin;
create table public.audit_log(
 id bigint generated always as identity primary key,
 occurred_at timestamptz not null default clock_timestamp(),
 -- No foreign key: history must survive member removal. Null means a system or maintenance change.
 actor_id uuid,
 entity text not null,
 entity_id text not null,
 label text,
 action text not null check(action in ('create','update','delete')),
 changes jsonb not null default '{}'::jsonb
);
create index audit_log_recent on public.audit_log(id desc);
create index audit_log_entity on public.audit_log(entity_id,id desc);
alter table public.audit_log enable row level security;
create policy office_gate_required on public.audit_log as restrictive for all to anon,authenticated
using((select public.office_gate_valid())) with check((select public.office_gate_valid()));
create policy audit_admin_read on public.audit_log for select to authenticated using((select public.office_role())='admin');
revoke all on public.audit_log from public,anon,authenticated;
grant select on public.audit_log to authenticated;

create function public.audit_log_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Change history is append-only'; end $$;
create trigger audit_log_immutable before update or delete on public.audit_log for each row execute function public.audit_log_immutable();

-- TG_ARGV: entity name, id column, label column ('' for none), then columns left out of the recorded changes.
create function public.record_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare
 old_row jsonb:=case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
 new_row jsonb:=case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
 ignored text[]:=coalesce(tg_argv[3:],'{}');
 diff jsonb:='{}'::jsonb;key text;
 subject jsonb:=coalesce(new_row,old_row);
begin
 for key in select jsonb_object_keys(subject) loop
  continue when key=any(ignored);
  if tg_op='UPDATE' then
   if old_row->key is distinct from new_row->key then diff:=diff||jsonb_build_object(key,jsonb_build_object('from',old_row->key,'to',new_row->key));end if;
  elsif tg_op='INSERT' then
   if new_row->key<>'null'::jsonb then diff:=diff||jsonb_build_object(key,jsonb_build_object('to',new_row->key));end if;
  elsif old_row->key<>'null'::jsonb then diff:=diff||jsonb_build_object(key,jsonb_build_object('from',old_row->key));
  end if;
 end loop;
 -- Updates touching only ignored columns (stock quantities, revision counters, timestamps) are not history entries.
 if tg_op='UPDATE' and diff='{}'::jsonb then return null;end if;
 insert into public.audit_log(actor_id,entity,entity_id,label,action,changes)
 values(auth.uid(),tg_argv[0],subject->>tg_argv[1],nullif(subject->>nullif(tg_argv[2],''),''),
  case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,diff);
 return null;
end $$;
revoke all on function public.record_audit() from public,anon,authenticated;

create trigger audit_items after insert or update or delete on public.items for each row
 execute function public.record_audit('item','id','name','id','quantity','stock_revision','updated_at','created_at','archived_at');
create trigger audit_item_costs after insert or update or delete on public.item_costs for each row
 execute function public.record_audit('item_cost','item_id','','item_id');
create trigger audit_locations after insert or update or delete on public.locations for each row
 execute function public.record_audit('location','id','name','id');
create trigger audit_members after insert or update or delete on public.members for each row
 execute function public.record_audit('member','id','name','id');
create trigger audit_invitations after insert or update or delete on public.invitations for each row
 execute function public.record_audit('invitation','id','email','id','created_at','expires_at','invited_by');
create trigger audit_movements after insert on public.movements for each row
 execute function public.record_audit('movement','id','','id','actor_id','created_at','note','delta','before_quantity','after_quantity',
  'source_before','source_after','target_before','target_after','requested_quantity','request_id','request_payload');
create trigger audit_stock_counts after insert or update or delete on public.stock_counts for each row
 execute function public.record_audit('stock_count','id','title','id','created_by','created_at','started_at','submitted_at','completed_at');
create trigger audit_count_entries after insert on public.stock_count_entries for each row
 execute function public.record_audit('count_entry','id','','id','actor_id','created_at','baseline_revision');
create trigger audit_imports after insert on public.inventory_imports for each row
 execute function public.record_audit('import','id','kind','id','actor_id','created_at','payload','result');

create function public.audit_history(p_before bigint default null,p_limit integer default 100,p_entity_id text default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when (select public.office_role())='admin' then coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc)
  from (select * from public.audit_log where (p_before is null or id<p_before) and (p_entity_id is null or entity_id=p_entity_id)
   order by id desc limit least(greatest(coalesce(p_limit,100),1),500)) a),'[]'::jsonb) end
$$;
revoke all on function public.audit_history(bigint,integer,text) from public,anon,authenticated;
grant execute on function public.audit_history(bigint,integer,text) to authenticated;
commit;
